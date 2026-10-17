import os
import re
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .pipeline import BusyError, Pipeline, uid
from .services import Services
from .store import Store
from .library import VideoLibrary
from .catalog_media import create_router
from . import visuals

STATIC = Path(__file__).parent / 'static'


class BrowserBoundary:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = dict(scope.get('headers', []))
        origin = headers.get(b'origin', b'').decode('latin-1')
        host = headers.get(b'host', b'').decode('latin-1')
        if origin and urlparse(origin).netloc != host:
            return await JSONResponse({'detail': 'Only same-origin requests are accepted.'}, status_code=403)(scope, receive, send)

        async def protected_send(message):
            if message['type'] == 'http.response.start':
                message = dict(message, headers=list(message.get('headers', [])) + [
                    (b'x-content-type-options', b'nosniff'), (b'referrer-policy', b'no-referrer'),
                    (b'content-security-policy', b"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"),
                ])
            await send(message)

        return await self.app(scope, receive, protected_send)


class UploadBodyLimit:
    """Bound request bytes before Starlette spools multipart file contents."""
    def __init__(self, app, max_bytes=80_100_000):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['path'] != '/api/upload':
            return await self.app(scope, receive, send)
        length = dict(scope.get('headers', [])).get(b'content-length')
        if length:
            try:
                too_large = int(length) > self.max_bytes
            except ValueError:
                return await JSONResponse({'detail': 'Invalid request size.'}, status_code=400)(scope, receive, send)
            if too_large:
                return await JSONResponse({'detail': 'The upload limit is 80 MB.'}, status_code=413)(scope, receive, send)
        count = 0

        async def bounded_receive():
            nonlocal count
            message = await receive()
            if message['type'] == 'http.request':
                count += len(message.get('body', b''))
                if count > self.max_bytes:
                    raise HTTPException(413, 'The upload limit is 80 MB.')
            return message

        return await self.app(scope, bounded_receive, send)


class Identity(BaseModel):
    worker_id: str = Field(default='', max_length=60)
    task: str = Field(min_length=1, max_length=80)


class Review(BaseModel):
    reviewed: bool
    note: str = Field(default='', max_length=1000)


def create_app(root=None, services=None, library_root=None):
    root = Path(root or os.environ.get('WAREHOUSE_DATA', Path(__file__).resolve().parent.parent / 'data')).resolve()
    store = Store(root / 'warehouse.sqlite')
    pipeline = Pipeline(root, store, services if services is not None else Services())
    library = VideoLibrary(library_root or '/home/mmiki8052/data/worker-wellbeing')
    app = FastAPI(title='SiteSense — worker video evidence', docs_url=None, redoc_url=None)
    app.state.store, app.state.pipeline = store, pipeline
    app.include_router(create_router(library, root))
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'testserver'])
    app.add_middleware(UploadBodyLimit)
    app.add_middleware(BrowserBoundary)

    @app.exception_handler(BusyError)
    async def busy_handler(request, error):
        return JSONResponse({'detail': str(error)}, status_code=409)

    @app.get('/')
    def index():
        return FileResponse(STATIC / 'index.html')

    @app.get('/api/state')
    def state():
        clips = [{k: v for k, v in c.items() if k != 'vector'} for c in store.all('clips') if c.get('active', True)]
        visible_clip_ids = {c['id'] for c in clips}
        tracks = [{k: v for k, v in t.items() if k != 'samples'} for t in store.all('tracks')]
        latest = {}
        for analysis in store.all('analyses'):
            if analysis['clip_id'] not in visible_clip_ids:
                continue
            if analysis['clip_id'] not in latest or analysis['created_at'] >= latest[analysis['clip_id']]['created_at']:
                latest[analysis['clip_id']] = analysis
        return {'recordings': store.all('recordings'), 'tracks': tracks, 'clips': clips,
                'analyses': list(latest.values()), 'jobs': store.all('jobs')[-12:],
                'busy': pipeline.busy(), 'server_time': time.time(),
                'models': {'detector': 'YOLO11s', 'tracker': 'ByteTrack / supervision 0.26.1',
                           'embedding': 'nvidia/cosmos-embed1', 'reasoner': 'nvidia/cosmos3-nano-reasoner'}}

    @app.get('/api/health')
    def health():
        return {'services': pipeline.services.health()}

    @app.get('/api/library')
    def video_library():
        return {'videos': library.items()}

    @app.post('/api/library/{identifier}/analyse', status_code=202)
    def analyse_library(identifier: str):
        source = library.resolve(identifier)
        item = next((r for r in library.items() if r['id'] == identifier), None)
        if source is None or item is None:
            raise HTTPException(404, 'Dataset video not found.')
        return pipeline.submit_library(source, item)

    @app.get('/api/recordings/{recording_id}/tracking')
    def recording_tracking(recording_id: str):
        recording = store.get('recordings',recording_id)
        if not recording:
            raise HTTPException(404,'Recording not found.')
        return {'recording_id':recording_id,
                'width':recording['width'],'height':recording['height'],
                'fps':recording['fps'],'duration':recording['duration'],
                'tracks':[t for t in store.all('tracks') if t['recording_id']==recording_id]}

    @app.post('/api/sample', status_code=202)
    def sample():
        return pipeline.submit_sample()

    @app.get('/api/recordings/{recording_id}/visuals')
    def recording_visuals(recording_id: str):
        recording = store.get('recordings', recording_id)
        if not recording:
            raise HTTPException(404, 'Recording not found.')
        return visuals.read_artifact(root, recording)

    @app.post('/api/recordings/{recording_id}/visuals', status_code=202)
    def generate_recording_visuals(recording_id: str):
        try:
            return pipeline.submit_visuals(recording_id)
        except KeyError:
            raise HTTPException(404, 'Recording not found.') from None

    @app.post('/api/upload', status_code=202)
    async def upload(file: UploadFile = File(...), task: str = Form(...), captured_at: str = Form(...)):
        if pipeline.busy():
            raise BusyError('Wait for the current job to finish before uploading.')
        filename = Path((file.filename or '').replace('\\', '/')).name
        if not filename.lower().endswith('.mp4'):
            raise HTTPException(400, 'Upload an MP4 video.')
        if not 1 <= len(task.strip()) <= 80:
            raise HTTPException(400, 'Enter a task label between 1 and 80 characters.')
        try:
            captured = datetime.fromisoformat(captured_at.replace('Z', '+00:00'))
            if captured.tzinfo is None:
                raise ValueError()
            timestamp = captured.timestamp()
            if not 0 <= timestamp <= time.time() + 86400:
                raise ValueError()
        except ValueError:
            raise HTTPException(400, 'Provide a valid capture date and time with a timezone.') from None
        directory = root / uid()
        directory.mkdir()
        source = directory / 'source.mp4'
        try:
            count = 0
            with source.open('wb') as output:
                while block := await file.read(1024 * 1024):
                    count += len(block)
                    if count > 80_000_000:
                        raise HTTPException(413, 'The upload limit is 80 MB. Use a 1–30 second clip.')
                    output.write(block)
            if count == 0:
                raise HTTPException(400, 'The video file is empty.')
            return pipeline.submit_upload(source, filename[:200], task.strip(), timestamp)
        except Exception:
            source.unlink(missing_ok=True)
            raise
        finally:
            await file.close()

    @app.post('/api/tracks/{track_key}/identity')
    def identity(track_key: str, body: Identity):
        worker = body.worker_id.strip()
        if worker and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 _.\-]{0,59}', worker):
            raise HTTPException(400, 'Use letters, numbers, spaces, dots, underscores or hyphens for a worker ID.')
        if not body.task.strip():
            raise HTTPException(400, 'A task label is required.')
        try:
            pipeline.confirm_identity(track_key, worker, body.task.strip())
        except KeyError:
            raise HTTPException(404, 'Track not found.') from None
        return {'ok': True}

    @app.post('/api/tracks/{track_key}/compare', status_code=202)
    def compare(track_key: str):
        try:
            return pipeline.submit_reanalysis(track_key)
        except KeyError:
            raise HTTPException(404, 'Track not found.') from None

    @app.post('/api/analyses/{analysis_id}/review')
    def review(analysis_id: str, body: Review):
        if pipeline.busy():
            raise BusyError('Wait for processing to finish before saving a review.')
        item = store.get('analyses', analysis_id)
        if not item:
            raise HTTPException(404, 'Analysis not found.')
        if item['status'] != 'complete':
            raise HTTPException(400, 'Only a complete comparison can be marked reviewed.')
        return store.update('analyses', analysis_id, reviewed=body.reviewed, review_note=body.note.strip(),
                            reviewed_at=time.time())

    @app.get('/media/{relative_path:path}')
    def media_file(relative_path: str):
        path = (root / relative_path).resolve()
        if not path.is_relative_to(root) or not path.is_file() or path.suffix not in ('.mp4', '.jpg'):
            raise HTTPException(404, 'Media not found.')
        return FileResponse(path)

    app.mount('/static', StaticFiles(directory=STATIC), name='static')
    return app
