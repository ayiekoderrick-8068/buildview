# Implementation status (Prompts 1 – 3)

Verified on Node 22, Python 3.14 / ezdxf 1.4.5 / FastAPI 0.162, Ubuntu 26.04 (WSL2), PostgreSQL 17 (embedded), headless
Chromium with SwiftShader WebGL (software rasteriser, no GPU).

## Verification results (last full run)

| Check | Result |
| --- | --- |
| `npm run typecheck` (strict TS, all workspaces + tests) | pass |
| `npm run lint` | pass |
| shared 3 · geometry-engine 38 · design-engine 28 · web 36 · API 33 (memory **and** real PostgreSQL, fake **and** real Python worker) | 138 / 138 pass |
| cad-worker (pytest: parser, units, blocks, malformed input, sandbox, HTTP, DWG refusal, golden files) | 14 / 14 pass |
| Playwright end-to-end (real API + PostgreSQL + worker + WebGL) | 17 / 17 pass (+2 opt-in screenshot generators) |

Not run: any real-GPU, multi-browser, or large-real-world-drawing testing.

## Status by area

**Implemented and tested**

- **Import pipeline (Milestone A)**: validated upload (extension + signature + size), SHA-256, private storage with server-generated names, background
  job with status/retry, Python worker in a resource-limited process, layer/unit/unsupported-entity reporting, original preserved and re-downloadable.
  DWG is detected and **honestly reported unavailable**. Units must be confirmed; layers are mapped by the architect.
- **Recognition**: walls (centre-line and double-line), duplicates, collinear merge, tolerance-bound gap closing (reported), openings from block inserts with
  measured width, rooms from outlines or wall topology, deterministic ids, source handles. Golden worker outputs are committed as fixtures.
- **2D plan editor (Milestone B)**: draw/select/move/delete walls, drag endpoints (connected walls follow), numeric length/thickness/height, doors/windows
  with sliding along the host wall (clamped, no overlap), room boundaries, auto-detected rooms, measure tool, grid + endpoint + along-wall + ortho snapping with
  a visible radius, mm/cm/m/ft-in display units, layers panel (model + CAD layers), CAD underlay, zoom/pan/fit, coordinate readout, undo/redo, save.
- **Validation (Milestone C)**: ~25 deterministic checks with severity, affected ids, suggestion, source handles and acknowledge flow; critical issues block
  approval and 3D access in the UI **and** on the server.
- **3D generation (Milestone D)**: real wall boxes with opening cut-outs, corner joins, floors/ceilings per room, opening frames/glass, optional flat roof,
  incremental per-wall rebuilds, camera framing for any plan, first-person walkthrough with wall collision.
- **Synchronised design studio (Milestone E)**: one document drives 2D and 3D; selection syncs both ways; the Prompt 1 tools (paint, finishes, plaster texture,
  roughness/metalness, furniture, lighting, undo/redo) work on generated walls; floors and ceilings are paintable; materials survive geometry edits and re-imports.
- **Persistence**: transactional revisions, optimistic concurrency, v1→v2 upgrade on read, source references, server-side approval check.
- **Prompt 1 features** retained (sample living room, wall painting, furniture editing, lighting, camera modes).

**Partially implemented**

- Roof: flat slab over the **convex hull** of the walls only (non-convex plans are over-covered).
- Walkthrough: wall/sill collision only; no furniture collision, stairs or gravity; look by drag (no pointer lock).
- Plan editor is SVG: fine for hundreds of elements (220 walls analysed in ~150 ms), but interactive frame rates on thousands of elements and on touch devices are untested.
- Multi-storey: the schema has levels and validation flags >1 level; only one level is generated/edited.
- Curved walls are approximated by straight segments (flagged for review); no arc drawing tool.

**Blocked / not available**

- **DWG import** (needs a licensed converter; not bundled; code path deliberately absent).
- **Malware scanning** (no scanner in this environment; reported as unavailable).
- **Authentication / users / sharing**: the API has no accounts. Access control is project-scoped (downloads, source references) only.

**Planned (visible as disabled in the UI)**: offline Render, alternative designs, Décor and Exterior tools.

## Honest caveats on accuracy

- Recognition was validated only against **synthetic reference drawings generated with ezdxf** (single-storey, centre-line and double-line, feet and mm,
  nested blocks, gaps, duplicates, curves). Accuracy on real architects' drawings is **unproven**; expect to map layers and review elements.
- Door/window **heights and sills are not in a DXF**; defaults are applied and flagged. Wall thickness in centre-line drawings is an assumption set by the user.
- Corner joins are exact for 90° corners and approximate otherwise.
- This is visualisation software: nothing here is a certified structural analysis or a construction drawing.

## Deviations from the brief (and why)

- **Normalised element tables** (walls/openings/materials/validation issues/generation jobs/generated assets) were not created; the building model is one
  validated, versioned JSON document per revision. Source files, import jobs and layers *are* normalised. 3D is derived at runtime, so there are no persisted
  generated assets or model-generation jobs yet.
- Wall `openings: string[]` from the example schema is replaced by `Opening.wallId` (one source of truth, no drift).
- Import jobs run in an in-process queue (bounded concurrency, DB-backed status, retry) rather than an external queue; a restart leaves unfinished jobs for retry.
- Browser-side CAD processing: the heavy part (parsing) is server-side; deterministic recognition runs in the page (milliseconds for the fixtures).
- Level-of-detail was not needed at this scene size; quality levels, on-demand rendering and per-wall incremental rebuilds are implemented instead.
- Duplicating a project drops its source references (the copy has no underlay).

## Performance observations

- Geometry pipeline, 220-wall / 100-room synthetic plan (Node, this machine): topology 152 ms, validation 114 ms, wall-box generation 40 ms.
- Rebuild granularity is asserted in tests: paint change = 0 geometry rebuilds; moving a window = 1 wall; changing a thickness = that wall + joined neighbours.
- Browser frame rates were **not** measured on real hardware (software WebGL only). Diagnostics overlay and quality levels exist for that measurement.
