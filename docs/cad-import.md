# CAD import: formats, recognition rules and limits

## Formats

| Format | Status |
| --- | --- |
| **DXF** (ASCII or binary, R12+ as supported by ezdxf 1.4) | Implemented and tested with generated reference drawings |
| **DWG** | **Not available.** DWG is proprietary; ezdxf cannot read it. The upload is accepted and stored, the import job fails with `dwg_unavailable`, and the UI says so. A licensed converter (e.g. the Open Design Alliance File Converter) must be installed and licensed by the operator, then wired into `apps/cad-worker/app/main.py`; that path is intentionally not implemented because it cannot be tested or licensed here. |

Licences checked: ezdxf (MIT), FastAPI/uvicorn (MIT/BSD), three.js (MIT), lucide (ISC), embedded-postgres/PostgreSQL (PostgreSQL licence).
Nothing proprietary is bundled.

## What the parser extracts

Units (`$INSUNITS`), layers with per-type counts, LINE, LWPOLYLINE, POLYLINE (2D; 3D flattened with a warning), ARC, CIRCLE,
INSERT/BLOCK (expanded to depth 3 with transforms, block bounds recorded), CAD **handles** for every entity (`parent/child`
for block contents), and drawing extents. Every other entity type is **counted and reported** (`unsupported`), e.g. SPLINE,
HATCH, DIMENSION, TEXT. Annotation types are informational; others are warnings.

## Units and scale

The header unit is shown but **the architect must press "Confirm units"** before anything is recognised. A drawing without
units (`$INSUNITS = 0`) has no default; a wrong choice is visible (the UI shows the span of the wall line work at the chosen scale
so a 1000× error is obvious). Nothing is inferred from geometry size.

## Recognition (deterministic, `geometry-engine/src/recognition.ts`)

1. **Layer mapping** → wall / door / window / room outline / ignore. Suggested from layer names; fully editable.
2. **Walls**
   - *Centre lines*: each line/polyline segment is a wall. Thickness is **not in the drawing**, so the architect sets an assumed
     thickness (recorded as an info note).
   - *Double lines*: parallel lines 50–500 mm apart (within 1°) are paired into one wall with measured thickness; unpaired
     lines are reported.
   - Arcs and bulged polylines are approximated by ≤15° segments and flagged `needs-review`.
   - Exact duplicates are merged (reported); collinear continuations are merged; **gaps up to the chosen tolerance (default 20 mm)
     are closed by moving the loose endpoint to the intersection and every move is recorded and flagged for review**. Larger
     gaps are left and reported by validation.
3. **Openings**: block INSERTs on door/window layers. The insertion point must lie on or near the host wall (≤ half thickness + 150 mm);
   width is the block's extent along the wall; position is the extent's centre. **Heights and sills are not in a DXF** so defaults are used and
   noted. Nested inserts count once (outermost). Door line-work without blocks, or openings drawn as gaps in a wall, are **not** recognised.
4. **Rooms**: closed polylines on a "room" layer, otherwise closed wall loops found by planar topology (T-junctions split,
   free ends pruned, faces inset by half the wall thickness).
5. **Provenance**: each element keeps its source handles; `verificationStatus` = `detected` (unreviewed), `needs-review` (something
   was assumed/repaired), `reviewed` (architect confirmed or edited), `manual` (drawn in the editor).

Identifiers are deterministic (`WALL-001…` ordered by position), so re-importing the same drawing yields the same ids and
existing materials re-attach.

## Validation (`geometry-engine/src/validation.ts`)

Critical (block approval/3D): zero/negative size, duplicate walls, overlapping walls, wall gaps ≤ 0.5 m, openings wider than the wall /
outside it / taller than it / overlapping / orphaned, self-intersecting or zero-area rooms, unknown levels, truncated drawings.
Warnings: free wall ends, crossings without a joint, open room boundaries, elements flagged for review, furniture outside rooms,
multiple levels. Info: orphaned materials, unreviewed elements, import assumptions. Warnings/info can be acknowledged; critical issues cannot.

## Security notes

Extension + signature checks, 25 MB limit, SHA-256, server-generated storage names, safe display names, project-scoped download,
`nosniff`/attachment headers, sandboxed worker process with timeout and memory/CPU limits, no execution of drawing content.
**Not available here:** malware scanning (reported as unavailable by `/api/health`), authentication/users, rate limiting.
