# Architecture

## Principle: one canonical, typed building model

Everything the user sees is derived from one validated document (`SceneDocumentSchema`, schema version 2, in
`packages/shared`). **The Three.js scene graph, the SVG plan and any future GLB are derived views, never the source of truth.**

```text
 uploaded DXF ──► cad-worker (Python/ezdxf) ──► CadParseResult (raw geometry, drawing units)
                                                    │  architect confirms units + layer mapping
                                                    ▼
                         geometry-engine: recognizeBuilding()  (deterministic, no AI)
                                                    ▼
   SceneDocument v2 ◄── design-engine plan ops ◄── 2D plan editor (SVG)
   levels · walls · openings · rooms · surfaces · furniture · lighting · sources · approval
        │                  ▲                              ▲
        │ validateDocument()│ undo/redo history           │ same selection + same document
        ▼                  │                              │
   issues (critical blocks approval)        3D scene (R3F) ─┘  incremental per-wall rebuilds
```

### Coordinates and units (one documented mapping)

- **Plan space**: metres, x = east, **y = north** (CAD convention). **World/3D space**: X = plan x, Y = up, **Z = −plan y**.
  A wall's rotation about Y for plan direction (dx, dy) is `atan2(dy, dx)`. Used by walls, openings, rooms, furniture,
  camera poses, the walk controller and the plan editor, with tests (`scene.test.tsx`) asserting it.
- Geometry is **always stored in metres**. Display units (mm, cm, m, ft-in) only change formatting/parsing (`units.ts`).
- Stored values are quantised to 0.01 mm (`q()`), never coarser; snapping only moves a point when a target is within a
  10-pixel radius and reports which kind of snap was used. CAD coordinates are shifted by `originM` (recorded in the
  source reference) so rendering stays numerically well-behaved far from the origin.

### Document layers (a material edit can never touch geometry)

| Layer | Fields | Edited by |
| --- | --- | --- |
| Structure | `levels`, `walls` (centre line, thickness, height), `openings`, `rooms`, `roof` | plan operations (`plan.ts`) |
| Appearance | `surfaces[elementId]` (wall id, `<room>:floor`, `<room>:ceiling`, `roof`) | `updateSurfaces` |
| Objects | `furniture[]` | furniture operations |
| Lighting | `lighting` | `setLighting` |
| Provenance | `sources[]` (file, SHA-256, confirmed unit, layer map, recognition notes), per-element `sourceHandles`, `verificationStatus`, `notes` | import + review |
| Workflow | `acknowledgedIssues`, `approval` | validation panel |

Materials are keyed by **stable element id**, so they survive geometry edits and re-imports (ids are deterministic:
`WALL-001…` sorted by position). When an element is deleted its material is kept and reported as an *orphan* note, not
silently dropped; furniture left outside rooms is reported, not deleted.

## Packages

```text
shared ──► geometry-engine ──► design-engine ──► apps/web
   └──────────────────────────────────────────► apps/api ◄──HTTP── apps/cad-worker (Python)
```

- **shared** – Zod schemas/types: building document, CAD parse result, import jobs, API contracts, presets.
- **geometry-engine** (pure TS) – wall boxes with real opening cut-outs, corner joins, planar topology (T-junction splitting,
  face detection, room inset), recognition, validation, units, furniture placement, walk collision.
- **design-engine** (pure TS) – document operations (surfaces, furniture, plan editing), snapping, undo/redo history,
  sample room, v1→v2 migration.
- **ui** – presentational components. **apps/web** – React editor. **apps/api** – Fastify + Prisma. **apps/cad-worker** – FastAPI + ezdxf.

## CAD import pipeline

1. `POST /api/projects/:id/sources` (raw body, `X-Filename`): extension **and** content signature must match (DXF group-code
   header or DWG `AC10xx`), size ≤ 25 MB, SHA-256 computed, file saved under a **server-generated** name (mode 0600, outside
   any web root), job queued and the request returns `202` immediately.
2. An in-process runner (concurrency 2) sends the bytes to the worker. The worker parses in a **separate, resource-limited
   process** (30 s timeout, 2 GB address-space limit, CPU limit, 100 k entity cap). ezdxf only parses data; nothing in a
   drawing is executed.
3. The result is validated against `CadParseResultSchema` and stored on the job (`ImportJob.result`, `DrawingLayer` rows). Failures
   record a code and message (`malformed_dxf`, `dwg_unavailable`, `worker_unreachable`, …) and can be retried.
4. In the browser the architect confirms units, maps layers, chooses wall representation, and reviews the live recognition
   preview. Applying it produces a normal document revision (undoable) with `sources[]` provenance.
5. The original file is never modified; it can be downloaded again byte-for-byte (project-scoped route).

See [cad-import.md](cad-import.md) for the recognition rules.

## Persistence

- `Project.document` (validated JSON) + immutable `ProjectRevision` per save, optimistic concurrency (`baseRevision`, `409`).
  Legacy v1 documents are upgraded on read.
- `CadSource`, `ImportJob`, `DrawingLayer` are normalised tables. Walls/openings/rooms/materials live inside the versioned
  document (a deliberate trade-off: one transactional, schema-validated unit per revision; summary counts are denormalised).
- The server re-validates approval: a document marked *approved* with open critical issues is refused (`422 approval_blocked`),
  and `sources[]` must belong to the project.

## 3D generation and incremental updates

`Room.tsx` builds one `WallMesh` per wall from `wallBoxes()` (real boxes around each opening; corner extensions from
`wallExtensions()`), one floor/ceiling per room, optional flat roof, opening frames/glass. Each wall computes a geometry key
from its own coordinates, its joins and its openings; **only walls whose key changes rebuild** (tested via `wallBuilds`
counters: a paint change rebuilds nothing, moving a window rebuilds only its host wall, changing a thickness rebuilds that wall
and the walls joined to it). Materials are per-surface instances updated in place.

## Performance decisions

On-demand rendering; quality levels (DPR, shadow size, AA); shared unit geometries for furniture; per-wall geometry/material
disposal; dimension labels are DOM overlays (not in the canvas); validation is deferred (`useDeferredValue`) so drags stay
smooth; CAD parsing is off the browser entirely. Measured: see [implementation-status.md](implementation-status.md).
