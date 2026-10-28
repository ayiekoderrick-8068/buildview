# Roadmap and recommended next steps

## Recommended next milestone (G): prove it on real drawings

1. **Collect 5–10 anonymised real architect DXFs** (single-storey houses, different drafting standards, layer conventions, units) and add them as golden
   fixtures. Measure recognition precision/recall per element type and tune layer heuristics. This is the single biggest unknown today.
2. **Door/window recognition beyond block inserts**: gaps in wall line-work, swing arcs without blocks, attribute-carried heights (`ATTRIB`), and a
   "promote line-work to opening" tool in the plan.
3. **Wall joins**: proper mitre for non-90° corners and T-junction cleanup; arc wall drawing; wall splitting/merging tools.
4. **DWG**: decide the licensed converter (ODA File Converter or a commercial SDK), legal review, then implement `convert_dwg` behind the existing
   `dwg_unavailable` contract with golden DWG fixtures.

## After that

- Multi-storey: level manager, stair/slab handling, per-level plan view, vertical alignment validation.
- Pitched/hip roofs from explicit user parameters; true outline (concave) roof/slab polygons.
- Normalised element tables + element-level revision diffs; model-generation jobs and GLB export as derived artifacts.
- Auth/users, roles, sharing, client approval workflow, comments pinned to elements; malware scanning in the upload path; durable job queue.
- Per-face wall materials (interior/exterior), texture libraries, glTF furniture with Draco/KTX2 in `public-assets/`.
- Performance pass on real hardware: FPS/memory budgets for a defined mid-range laptop, LOD/instancing, WebWorker for recognition on very large drawings.
- Accessibility pass (keyboard-operable plan editing, screen-reader summaries), cross-browser tests.
- Offline renders (GPU worker), real-estate presentation mode, AI-assisted suggestions that propose *patches* against the document for the architect to approve.
