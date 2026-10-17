# SiteSense — worker video evidence

The deployed React frontend directly reuses the team's [hack2](https://github.com/londrwus/hack2/) visual system, kit, sidebar, cards, upload hero and detail composition. Its actual API adapter connects to this project's existing YOLO/ByteTrack/Cosmos/OpenCV pipeline. Source provenance and build instructions are in `frontend/README.md`.

All 85 dataset videos remain available: 14 construction and 71 factory. Seven dataset recordings and the separate warehouse simulation have now completed the full pipeline, producing 19 recording-scoped tracklets. These counts are derived from the API. Other videos can be previewed and analysed directly from the library. A tracklet is not a verified unique worker across sessions.

Select a worker to open their recording, actual frame-aligned boxes and confidence-gated OpenCV poses. Annotated, Raw and Skeleton modes, movement trails, frame stepping, fullscreen and PNG snapshots are available. The selected worker's earlier/current videos, synchronized playback, eligible earlier matches and all observation windows appear below. Seeking selects the corresponding evidence; invalidated mappings hide old reports and references until recomputed. The UI presents human-review observations without inventing fatigue, height, job-fitness or health scores.

Reference-video UI update: a light sidebar workspace, a searchable visual catalog of all 85 dataset files plus the warehouse demo, collection/review filters, raw-video preview dialogs, and direct worker review. The player now includes real OpenCV pose overlays, Annotated/Raw/Skeleton views, optional motion trails, a scrubber, frame stepping, playback speed, fullscreen and annotated PNG snapshots. Earlier matches and all observation windows remain below the player.

Pose uses the official Apache-2.0 OpenCV Zoo MediaPipe model through OpenCV DNN on the VM CPU. It adds no Torch runtime. The 5.3 MiB model is checksum-verified by `python -m tools.download_pose_model`; model weights stay outside Git, and the license is in `docs/pose-model-LICENSE`. Pose is sampled at 6 fps from existing ByteTrack person crops and served separately at `/api/recordings/{id}/visuals`. Confidence-gated joints use the normalized video's pixel coordinates; gaps remain gaps. This is a 2D visualization, without depth, calibrated height or medical measurements. The construction clip produced 297 accepted person-pose samples in 3.13 seconds; the warehouse clip produced 59 in 0.67 seconds. Future video ingests add this optional layer after successful Cosmos comparison, and pose failure preserves those comparisons.

Regenerate overlays on the VM with `.venv/bin/python -m tools.generate_visuals RECORDING_ID --fps 6`. Set `WAREHOUSE_POSE_AUTO=0` to disable automatic inference. Visual cache refresh is keyed to the recording's jobs so a browser sees pose completion without reloading. All 85 real poster images are cached separately; unanalysed videos do not receive worker counts or review judgments.

The interface now opens with a management overview. Select a worker to open a dedicated review screen with the full recording, real frame-aligned ByteTrack boxes, worker review cards and a seekable evidence timeline. Supporting retrieved clips and the complete observation history appear below. Counts are derived from actual indexed workers and model review flags; no wellbeing, fatigue or medical scores are fabricated.

A working video evidence pipeline on the assigned lab VM. No model training or local GPU is required. The VM orchestrates shared GPU services. App code and persisted results are in `/home/mmiki8052/warehouse-prototype`.

The VM library picker lists all 85 downloaded videos (14 construction and 71 factory) from `/home/mmiki8052/data/worker-wellbeing`. Select a video and choose Analyse; completed recordings can be reopened without model calls. Source files remain untouched. Each dataset recording is indexed into three-second windows. Capture dates and cross-session identities are unverified, so dataset comparisons and history stay within the continuous track, even after assigning a worker ID.

Verified real construction run: `02-rooftop-crew-closer.mp4`, 15.3 seconds normalized, 459 frames, four usable tracks, 19 embedded windows, 15 Cosmos comparison reports, four initial baselines and two model review flags. The full run took 95.4 seconds. These flags are model observations, not labelled wellbeing outcomes. Other library videos are available for processing on selection; listing 85 files does not mean all 85 are indexed.

The management view now centers the videos: a compact review queue, large current/reference playback, shared play/pause/seek, Scene/Person switching, a playable gallery of earlier matches and a five-clip visual history. Long reports and operational controls are collapsed under Details. The included ten-second scene is now indexed as five two-second windows; the latest window has four eligible earlier matches. These are portions of one simulated recording, not separate historical sessions. Review flags suggest a human check-in and do not diagnose wellbeing.

## Open the dashboard

Shared VM link: **https://deposits-hub-greatly-region.trycloudflare.com**. The shared dashboard is public; anyone with this link can use it without signing in. The VM runs the tunnel and loopback adapter as detached processes, so the laptop and its SSH connection can close. The hostname is temporary and changes after recreating the tunnel. Run `.venv/bin/python start_sharing.py` on the VM to reopen the existing sharing state. Files `sharing-processes.json` and the two `sharing-*.log` files record this session. `tools/cloudflared` is the official Linux binary, downloaded with its GitHub release SHA-256 digest verified. No system package was installed.

The adapter forwards to the existing app on port 8765 and preserves video Range requests. Only the exact generated public origin can make browser writes; foreign origins are rejected. Cloudflare Access cookies and identity headers are not forwarded to the app. The existing local laptop URL below also continues to work.

On the laptop, keep an SSH tunnel running:

```powershell
ssh -N -L 18765:127.0.0.1:8765 bc-mmiki8052
```

Then open **http://127.0.0.1:18765**. The server binds only `127.0.0.1` on the VM. The tunnel must stay open. A tunnel was started during setup.

To open the project in Cursor from the laptop:

```powershell
cursor --remote ssh-remote+bc-mmiki8052 /home/mmiki8052/warehouse-prototype
```

## Start / restart on the VM

```bash
cd /home/mmiki8052/warehouse-prototype
.venv/bin/python start.py
```

`start.py` detaches the process from the SSH session and records `server.pid`; it does not install a system service. To restart, verify that the recorded PID belongs to this project's `serve.py` before stopping it, then run `start.py` again. Server logs are in `server.log`. Do not run multiple app workers: the single-worker queue deliberately limits shared GPU calls.

```bash
.venv/bin/python -m pytest -q
```

Dependencies are private to `.venv`. The initial setup used Python's `venv --without-pip` and the official `https://bootstrap.pypa.io/pip/pip.pyz` because Ubuntu's ensurepip is unavailable. No apt/system package installation. `requirements.txt` describes runtime requirements; `requirements.lock` records the tested full environment. Supervision is pinned to 0.26.1 because later releases removed its ByteTrack API ([official versioned reference](https://supervision.roboflow.com/0.26.1/trackers/)). FFmpeg/FFprobe are preinstalled on the VM.

## Pipeline

1. **Import** the assigned warehouse sample from the workshop library, or upload a 1–30 second MP4 (80 MB maximum) with a real capture timestamp and task label. Exact duplicates are rejected. Original source and normalized context are preserved.
2. **Detect** people with the shared YOLO11s service after standardizing to 30 fps and at most 1280×720. Detector frame indices therefore match video timestamps.
3. **Track** with real ByteTrack on the CPU. A track ID is valid inside one recording only. Up to four tracks with at least 1.5 seconds and 60% observed-frame coverage are processed. No cross-camera identity inference.
4. **Crop** non-overlapping windows of at most five seconds. Each fixed crop covers that track's observed path with padding; it can include other people or objects. Windows with insufficient detections abstain. The full scene is retained alongside every crop. FFmpeg writes standard H.264 seekable MP4s, not fragmented MP4s.
5. **Embed** each crop using `nvidia/cosmos-embed1`. Validate and normalize its 256D vector; save it in SQLite with worker/track, recording, task, time, source and visibility metadata.
6. **Retrieve** only earlier, non-overlapping windows of the same task. Inside one recording, the same continuous ByteTrack ID is eligible. Across recordings, both identities must be human-confirmed with the same worker ID, and real capture times are required. Only then rank candidates by exact cosine similarity. This intentionally small prototype uses a local vector index; the shared corpus has no persistent worker IDs suitable for this filter.
7. **Reason** with `nvidia/cosmos3-nano-reasoner`: assemble one video containing earlier crop, current crop and current scene. The service accepts one video per prompt. Require structured JSON describing observable changes, task alternatives, limitations and an unvalidated review suggestion. Invalid model output fails the job; it is never recorded as a successful comparison.
8. **Review** the source evidence, model observations and timeline. Confirm a worker/task mapping when independently known, then recompute. Changing a mapping invalidates affected reports. Save a human review note. No emails or automatic management alerts are sent.

The first window establishes a baseline and makes no change claim. A later window without an eligible reference also abstains. Similarity is a retrieval score, not health confidence. Credentials come only from `/config/team-2.config`, stay in server memory and are never sent to the browser. Failed/interrupted jobs cannot appear completed.

## What the included demo proves

The supplied sample is a **10-second simulated warehouse recording**, not a months-long construction dataset. The initial real run processed 300 frames, kept one track at 99% observed-frame coverage, generated two five-second person crops, stored two 256D embeddings, retrieved the earlier crop, and obtained a valid Cosmos comparison. The full job took about 10.2 seconds on the tested VM and shared services; latency will vary with shared load.

It proves service integration and a within-recording evidence workflow. It does **not** validate wellbeing, emotion, fatigue, true worker identity or long-term change. A model can misdescribe visible actions. A reviewer must inspect the footage. Demo recordings without real capture dates are explicitly excluded from cross-recording historical retrieval even if someone labels a worker ID.

For actual longitudinal use, supply repeated recordings with trustworthy timestamps, task labels and independently confirmed worker mappings. The other dataset search can feed that path later. This is a short-clip hackathon prototype, not a continuous camera ingestion or production monitoring system.

## Files and routes

`warehouse/core.py`: filters and validation; `tracking.py`: ByteTrack; `media.py`: FFmpeg; `services.py`: workshop clients; `pipeline.py`: jobs and orchestration; `store.py`: SQLite; `app.py`: API; `static/`: browser UI. Generated videos, vectors and metadata live in ignored `data/`. A public state response excludes raw vectors and frame-level boxes. Media routes prevent directory traversal. API mutations require same-origin browser requests; the server is local to the VM.

Useful endpoints: `GET /api/state`, `GET /api/health`, `POST /api/sample`, `POST /api/upload`, `POST /api/tracks/{id}/identity`, `POST /api/tracks/{id}/compare`, `POST /api/analyses/{id}/review`. Machine-readable API schema: `/openapi.json`. No external scripts or CDN assets are needed for the dashboard.

Frontend adapter regressions can be run on the development laptop with `node tests/test_sitesense.cjs`. The React build passes TypeScript and Vite checks. Public browser checks cover actual video playback, worker selection, time-aligned evidence, Raw/Skeleton modes and synchronized comparison videos. The backend suite has 39 passing tests. Node is not required on the VM; compiled assets are served from `warehouse/static/team-ui/`, with the built index copied to `warehouse/static/index.html`. Hash routes work through the existing FastAPI root. The CSP permits local inline React styles and local blob video previews; executable scripts remain restricted to the app origin.
