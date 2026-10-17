# SiteSense frontend

Adapted directly from the team's [londrwus/hack2 frontend](https://github.com/londrwus/hack2/tree/153c34b602cb14195ffb8571246ed47b8b60625a/frontend), revision `153c34b602cb14195ffb8571246ed47b8b60625a`.

The original visual system, reusable kit, shadcn controls, overview composition, sidebar, upload hero and video/detail layout are reused here. The data adapter and evidence player connect to this project's existing FastAPI/YOLO/ByteTrack/Cosmos/OpenCV pipeline. The mock-data API, readiness scores, depth videos and digital twin are not connected to the deployed app.

## Build

Use Node.js 20+ and pnpm. Dependencies are local to this frontend; the VM only serves the compiled files.

```
pnpm install --frozen-lockfile
pnpm run build
```

Copy `dist/` into `warehouse/static/team-ui/`, and copy its `index.html` to `warehouse/static/index.html`. Vite assets use `/static/team-ui/`; hash routing works through the existing FastAPI root and the public Cloudflare tunnel.

## Data

The dashboard reads `/api/state` and `/api/library` and preserves all 85 real library videos, seven analysed library recordings and the separate warehouse simulation. Counts are derived from API responses. A worker track is scoped to its recording and is not a unique cross-session person. More source clips can be previewed and submitted to the actual pipeline from their library page. Unanalysed footage never receives an invented wellbeing score.

The player overlays real normalized-frame detections and confidence-gated OpenCV MediaPipe33 results. Seeking selects the covering worker window and its report/reference; invalidated comparisons hide stale claims. Human review controls persist to the VM. Earlier candidates come only from the backend's eligible retrieval results. Uploads require a real capture time and activity.
