import hashlib
import math
import os
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import media, visuals
from .core import retrieve
from .services import ServiceError
from .tracking import track_people


def uid():
    return uuid.uuid4().hex


class BusyError(RuntimeError):
    pass


class Pipeline:
    def __init__(self, root, store, services):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.store, self.services = store, services
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='warehouse')
        self.lock = threading.RLock()
        self.future = None
        self.store.recover_jobs()

    def busy(self):
        return self.future is not None and not self.future.done()

    def submit(self, label, action):
        with self.lock:
            if self.busy():
                raise BusyError('A recording is already processing. Wait for that job to finish.')
            job = {'id': uid(), 'label': label, 'status': 'queued', 'stage': 'Preparing',
                   'progress': 0, 'created_at': time.time(), 'error': None, 'events': []}
            self.store.put('jobs', job)
            self.future = self.executor.submit(self.execute, job['id'], action)
            return job

    def stage(self, job, name, progress, detail=''):
        saved = self.store.get('jobs', job)
        events = saved['events'] + [{'stage': name, 'detail': detail, 'at': time.time()}]
        self.store.update('jobs', job, status='running', stage=name,
                          progress=max(progress, saved['progress']), events=events)

    def execute(self, job, action):
        try:
            result = action(job)
            self.store.update('jobs', job, status='completed', stage='Ready for review', progress=100,
                              result=result, finished_at=time.time())
        except Exception as error:
            # Never propagate an exception string from an HTTP library: it can contain a token URL.
            safe = str(error) if isinstance(error, (ServiceError, ValueError)) else 'Processing failed. Check the input and service health, then retry.'
            self.store.update('jobs', job, status='failed', error=safe[:400], finished_at=time.time())
            saved = self.store.get('jobs', job)
            if saved.get('recording_id'):
                recording = self.store.get('recordings', saved['recording_id'])
                if recording and recording['status'] == 'processing':
                    self.store.update('recordings', recording['id'], status='failed')

    def submit_sample(self):
        def action(job):
            existing = [r for r in self.store.all('recordings') if r.get('demo') and r.get('status') == 'ready']
            if existing:
                if existing[0].get('window_seconds') != 2:
                    return self.expand_demo(job, existing[0])
                self.stage(job, 'Opening saved warehouse demo', 95, 'Reusing persisted detections, clips and analysis.')
                return {'recording_id': existing[0]['id'], 'cached': True}
            recording_id = uid()
            directory = self.root / recording_id
            directory.mkdir()
            self.stage(job, 'Importing warehouse footage', 3, 'Reading the assigned workshop library.')
            source = directory / 'source.mp4'
            provenance = self.services.sample(source)
            return self.process(job, recording_id, source, provenance, 'warehouse activity', None)
        return self.submit('Warehouse demo', action)

    def expand_demo(self, job, recording):
        self.store.update('jobs', job, recording_id=recording['id'])
        tracks = [t for t in self.store.all('tracks') if t['recording_id'] == recording['id']]
        created = []
        for track in tracks:
            created.extend(self.index_windows(job, recording, track, 2., active=False))
        if not created:
            raise ValueError('No additional visible windows could be indexed.')
        # Draft clips and reports stay invisible until every replacement comparison succeeds.
        working = [dict(clip,active=True) for clip in created]
        for clip in working:
            self.analyze_clip(job, clip, candidates=working)
        self.store.publish_windows(recording['id'], [clip['id'] for clip in created], 2)
        return {'recording_id': recording['id'], 'windows': len(created), 'cached': False}

    def submit_upload(self, source, filename, task, captured_at):
        recording_id = source.parent.name
        return self.submit('Uploaded recording', lambda job: self.process(job, recording_id, source,
                           {'filename': filename, 'source': 'user upload', 'camera': 'Uploaded camera',
                            'location': 'User supplied', 'demo': False}, task, captured_at))

    def submit_library(self, source, item):
        def action(job):
            existing = next((r for r in self.store.all('recordings')
                             if r.get('library_id') == item['id'] and r.get('status') == 'ready'), None)
            if existing:
                return {'recording_id': existing['id'], 'cached': True}
            if source.stat().st_size > 80_000_000:
                raise ValueError('This recording exceeds the 80 MB processing limit.')
            media.probe(source)
            directory = self.root / uid()
            directory.mkdir()
            copy = directory / 'source.mp4'
            shutil.copyfile(source, copy)
            provenance = {'filename': item['filename'], 'source': item['relative_path'],
                          'camera': 'Dataset recording', 'location': item['collection'],
                          'demo': False, 'source_kind': 'dataset', 'library_id': item['id'],
                          'capture_time_known': False}
            return self.process(job, directory.name, copy, provenance,
                                item['collection'].lower() + ' activity', None)
        return self.submit('Dataset · ' + item['filename'], action)

    def create_visuals(self, job, recording):
        self.store.update('jobs', job, recording_id=recording['id'])
        self.stage(job, 'OpenCV pose inference', 5, 'MediaPipe33 estimates on observed ByteTrack person crops; low-confidence joints are hidden.')
        tracks = [t for t in self.store.all('tracks') if t['recording_id'] == recording['id']]
        try:
            visuals.save_artifact(self.root, recording, visuals.empty_artifact(recording, 'processing'))
            return visuals.generate_artifact(self.root, recording, tracks,
                progress=lambda value: self.stage(job, 'OpenCV pose inference', value))
        except Exception:
            visuals.save_artifact(self.root, recording, visuals.empty_artifact(recording, 'failed',
                'Optional pose inference was unavailable. Person tracking and Cosmos evidence are still available.'))
            raise ValueError('Optional pose inference was unavailable. Check the installed OpenCV Zoo model and retry.') from None

    def submit_visuals(self, recording_id):
        recording = self.store.get('recordings', recording_id)
        if not recording:
            raise KeyError(recording_id)
        def action(job):
            artifact = self.create_visuals(job, recording)
            return {'recording_id': recording_id, 'poses': artifact['statistics']['accepted']}
        return self.submit('Generate pose overlay', action)

    def process(self, job, recording_id, source, provenance, task, captured_at):
        directory = source.parent
        fingerprint = hashlib.sha256(source.read_bytes()).hexdigest()
        for previous in self.store.all('recordings'):
            if previous.get('sha256') == fingerprint and previous.get('status') == 'ready':
                raise ValueError('This exact recording is already indexed. Open it in the recording list.')
        self.stage(job, 'Preparing video', 8, 'Checking duration and standardizing video to 30 fps.')
        original_info = media.probe(source)
        normalized = directory / 'normalized.mp4'
        info = media.normalize(source, normalized)
        recording = dict(provenance, id=recording_id, sha256=fingerprint, task=task,
                         captured_at=captured_at, imported_at=time.time(), status='processing',
                         media_path=str(normalized.relative_to(self.root)),
                         window_seconds=2 if provenance['demo'] else 3 if provenance.get('source_kind') == 'dataset' else 5, **info)
        self.store.put('recordings', recording)
        self.store.update('jobs', job, recording_id=recording_id)
        self.stage(job, 'YOLO person detection', 16, 'Shared YOLO11s service; all frames, people only for tracking.')
        detection = self.services.detect(normalized)
        self.stage(job, 'ByteTrack association', 30, 'Temporary IDs scoped to this recording.')
        tracks = track_people(detection['frames'], info['fps'])
        usable = [t for t in tracks if t['end'] - t['start'] >= 1.5 and t['coverage'] >= .6][:4]
        self.store.update('recordings', recording_id, detector_frames=len(detection['frames']),
                          detected_tracks=len(tracks), processed_tracks=len(usable))
        if not usable:
            self.store.update('recordings', recording_id, status='no_usable_tracks')
            raise ValueError('No person track was visible long enough. Use a clearer clip with at least 1.5 seconds of person visibility.')
        created = []
        for index, track in enumerate(usable):
            identifier = f'{recording_id}-{track["track_id"]}'
            saved_track = self.store.put('tracks', dict(track, id=identifier, recording_id=recording_id,
                                         worker_id=None, identity_confirmed=False,
                                         label=f'Track {track["track_id"]}', task=task))
            created.extend(self.index_windows(job, recording, saved_track, recording['window_seconds']))
        if not created:
            raise ValueError('No windows had sufficient person visibility for comparison.')
        for index, clip in enumerate(created):
            self.stage(job, 'Historical retrieval', 65 + round(index / len(created) * 25),
                       'Filter identity, task and earlier time first; then rank by cosine similarity.')
            self.analyze_clip(job, clip)
        self.store.update('recordings', recording_id, status='ready')
        # Optional decoration runs after the evidence pipeline has succeeded.
        # An absent model or inference failure cannot invalidate that result.
        if os.environ.get('WAREHOUSE_POSE_AUTO', '1') != '0' and visuals.model_path().is_file():
            try:
                self.create_visuals(job, self.store.get('recordings', recording_id))
            except Exception:
                # Disk/model failures in this optional overlay cannot turn a
                # completed Cosmos evidence job into a failed import.
                pass
        return {'recording_id': recording_id, 'tracks': len(usable), 'windows': len(created), 'cached': False}

    def index_windows(self, job, recording, track, window_seconds, active=True):
        directory = self.root / recording['id']
        normalized = self.root / recording['media_path']
        created = []
        start, end = track['start'], min(recording['duration'], track['end'])
        while start + 1.5 <= end + .001:
            duration = min(window_seconds, end - start)
            clip_id = uid()
            crop, context = directory / f'{clip_id}.mp4', directory / f'{clip_id}-context.mp4'
            self.stage(job, 'Person-focused crops', 40, f'Creating {duration:.0f}s windows for Track {track["track_id"]}.')
            try:
                visibility = media.crop_window(normalized, crop, context, track, start, duration, recording)
            except ValueError:
                start += duration
                continue
            self.stage(job, 'Cosmos Embed1 indexing', 55, 'Indexing each clip separately.')
            vector = self.services.embed(crop)
            thumb = directory / f'{clip_id}.jpg'
            media.thumbnail(crop, thumb)
            item = dict(id=clip_id, recording_id=recording['id'], track_id=track['track_id'],
                        track_key=track['id'], worker_id=track.get('worker_id'),
                        identity_confirmed=track.get('identity_confirmed', False), task=track['task'],
                        started_at=(recording.get('captured_at') or 0) + start,
                        ended_at=(recording.get('captured_at') or 0) + start + duration,
                        offset=start, duration=duration, demo=recording['demo'], vector=vector, active=active,
                        capture_time_known=recording.get('captured_at') is not None,
                        media_path=str(crop.relative_to(self.root)), context_path=str(context.relative_to(self.root)),
                        thumbnail_path=str(thumb.relative_to(self.root)), **visibility)
            self.store.put('clips', item)
            created.append(item)
            start += duration
        return created

    def analyze_clip(self, job, clip, candidates=None):
        references = retrieve(clip, candidates if candidates is not None else self.store.all('clips'))
        base = {'id': uid(), 'clip_id': clip['id'], 'recording_id': clip['recording_id'],
                'track_key': clip['track_key'], 'created_at': time.time(), 'reviewed': False,
                'review_note': '', 'worker_id': clip['worker_id'], 'identity_confirmed': clip['identity_confirmed'],
                'reference_candidates': [{'clip_id': r['id'], 'similarity': r['similarity']} for r in references]}
        if not references:
            self.store.put('analyses', dict(base, status='no_reference', reference_id=None,
                summary='No eligible earlier reference. This window is indexed as a baseline; no change claim was made.'))
            return
        reference = references[0]
        comparison_path = self.root / clip['recording_id'] / f'{base["id"]}-comparison.mp4'
        media.comparison(self.root / reference['media_path'], self.root / clip['media_path'],
                         self.root / clip['context_path'], comparison_path)
        self.stage(job, 'Cosmos evidence comparison', 90,
                   'Comparing earlier crop, current crop and current full-scene context in one video.')
        same_recording = clip['recording_id'] == reference['recording_id']
        report = self.services.reason(comparison_path, same_recording,
                                      (reference['duration'], clip['duration'], clip['duration']))
        self.store.put('analyses', dict(base, status='complete', reference_id=reference['id'],
                        similarity=reference['similarity'], candidates=len(references), report=report,
                        summary=report['human_review_summary'], within_recording=same_recording,
                        comparison_path=str(comparison_path.relative_to(self.root))))

    def confirm_identity(self, track_key, worker_id, task):
        with self.lock:
            if self.busy():
                raise BusyError('Wait for processing to finish before confirming identity.')
            track = self.store.get('tracks', track_key)
            if not track:
                raise KeyError(track_key)
            if (track.get('worker_id') == (worker_id or None) and track.get('task') == task
                    and track.get('identity_confirmed', False) == bool(worker_id)):
                return
            # Existing reports are invalidated when a person/task mapping changes.
            self.store.update('tracks', track_key, worker_id=worker_id or None,
                              identity_confirmed=bool(worker_id), task=task)
            changed_clips = set()
            for clip in self.store.all('clips'):
                if clip['track_key'] == track_key:
                    changed_clips.add(clip['id'])
                    self.store.update('clips', clip['id'], worker_id=worker_id or None,
                                      identity_confirmed=bool(worker_id), task=task)
            for analysis in self.store.all('analyses'):
                if (analysis['track_key'] == track_key or analysis.get('reference_id') in changed_clips
                        or (analysis.get('worker_id') is not None
                            and analysis.get('worker_id') in (worker_id, track.get('worker_id')))):
                    self.store.update('analyses', analysis['id'], status='stale',
                                      summary='Identity or task changed. Run comparison again.', reviewed=False)

    def submit_reanalysis(self, track_key):
        track = self.store.get('tracks', track_key)
        if not track:
            raise KeyError(track_key)
        def action(job):
            clips = sorted([c for c in self.store.all('clips') if c['track_key'] == track_key and c.get('active', True)], key=lambda c: c['started_at'])
            for clip in clips:
                self.stage(job, 'Historical retrieval', 65, 'Using the current confirmed identity and task mapping.')
                self.analyze_clip(job, clip)
            return {'recording_id': track['recording_id'], 'track_key': track_key}
        return self.submit('Recompare track', action)
