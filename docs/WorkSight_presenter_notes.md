# WorkSight — visual-first slide and presenter notes

**Editable Canva slide (1 page):** https://www.canva.com/d/FOw_kYsLLwD_4D_

**Temporary live demo:** https://deposits-hub-greatly-region.trycloudflare.com/

The slide uses **illustrative warehouse imagery, not screenshots of the application**. Keep visible text brief; the detailed explanation belongs in Canva's speaker notes. The app is currently branded **SiteSense** in the repository, while this slide uses **WorkSight**; align branding before presenting.

## Slide 1 — See change. Review evidence. (approximately 60 seconds)

**0–12 s — The problem**

> Construction and warehouse footage is abundant, but a useful conclusion needs context. We want to make earlier and current moments easy to compare, with evidence a person can review.

**12–35 s — Point to the two video panels**

> YOLO11s locates people and ByteTrack follows a person within one continuous recording. Cosmos Embed1 represents short person-centered clips as 256-dimensional vectors and retrieves eligible earlier windows. Cosmos Reason compares the earlier and current windows alongside the surrounding scene, then describes observable differences and limitations.

**35–48 s — Point to the verified figures**

> On our documented first test using one 10-second simulated warehouse clip, we processed 300 frames, observed the selected track in 99% of frames, generated two 256-dimensional embeddings, and completed the job in about 10.2 seconds. These are measurements of **one initial test**, not accuracy, wellbeing validation, or a real-time guarantee.

**48–60 s — The human-review outcome**

> The reviewer can replay the evidence and record the outcome. This is not an automatic diagnosis of worker wellbeing. Now we'll show the live prototype.

## Speaker questions / integrity checks

- The two large warehouse images are **illustrations** and must not be called genuine app screenshots.
- **99%** is selected-track observation coverage, not detection accuracy.
- **ByteTrack IDs apply to one recording only**; cross-camera person identification is not demonstrated.
- The ~10.2-second result is one early simulated run. Do not imply latency consistency.
- The later **real construction** example in the repository's current README reports **459 normalized frames, four usable tracks, 19 embedded windows, 15 comparison reports and 95.4 seconds**. Do not mix these figures into the initial simulated run.
- Neither short-clip comparison nor video embeddings validate a person's wellbeing, fatigue, stress, mental health, or long-term identity.
- The Cloudflare demo hostname is temporary; check the live URL before presentation.

**Evidence/source:** [Repository README](https://github.com/tam7777/ConstructionWellbeing).
