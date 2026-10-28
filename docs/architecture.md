# Architecture

## Principle: layers that cannot corrupt each other

The editor works on one immutable **scene document** (`SceneDocumentSchema` in `packages/shared`). It is split
into layers that are edited by different code paths:

| Layer | Fields | Edited by |
| --- | --- | --- |
| Structure | `room`, `walls` (id, interior-face line, outward normal, height, thickness, openings) | nothing in the studio (read-only); future DXF/DWG import will produce it |
| Appearance | `surfaces[surfaceId]` (colour, finish, roughness, metalness, textureScale), keyed by wall id / `floor` / `ceiling` | `updateSurfaces` |
| Objects | `furniture[]` (position, rotation, size, flags, home transform) | `moveFurniture`, `rotateFurniture`, ... |
| Lighting | `lighting` | `setLighting` |

`updateSurfaces` returns a new `surfaces` map and **the same `walls`/`room` references**, so a material edit
cannot change a measurement; this is asserted by unit, scene and Playwright tests. Operations return the same
document reference for no-ops, so history never records empty steps.

Because geometry is canonical data (not meshes), importing a drawing later means producing `room` + `walls` in the
same shape; the renderer, history, persistence and API do not change.

## Packages

```
shared  ──►  geometry-engine  ──►  design-engine  ──►  apps/web
   └──────────────────────────────────────────────►  apps/api
```

- **shared** - Zod schemas (runtime validation *and* TypeScript types), API request/response contracts, paint and finish presets.
- **geometry-engine** - pure functions: decompose a wall with openings into solid boxes, wall dimensions, rectangular-room generator, furniture footprint clamping/overlap. No three.js dependency.
- **design-engine** - pure functions: document operations, snapshot history with coalescing and "transient" (drag) commits, the fictional sample room.
- **ui** - presentational components styled with Tailwind + CSS variables.

## Web app

- `state/editorStore.ts` (Zustand) holds the history, selection, view mode, save state and orchestrates the API. `dirty` is recomputed on commit/undo/redo only, never per drag frame.
- `scene/` is React Three Fiber:
  - `Room.tsx` builds walls from `wallBoxes()`; every wall gets **its own `MeshStandardMaterial`** (`useSurfaceMaterial`) kept in sync with `surfaces[wallId]`, so shared-material accidents are impossible. Wall boxes use world-metre UVs so the plaster bump texture has a consistent scale.
  - `Furniture.tsx` + `models.tsx` - procedural furniture assembled from three shared unit geometries. Dragging: window pointer events raycast to the floor plane; live moves skip history and the whole drag becomes one undo step.
  - `Lighting.tsx` - hemisphere + one shadow-casting directional light + two point lights; presets change colours/positions, sliders scale intensity.
  - `CameraRig.tsx` - perspective camera (3D) or orthographic top-down camera (2D plan), damped OrbitControls, animated reset/fit, pan limits.
- Rendering is **on demand** (`frameloop="demand"`): idle GPU use is ~0; changes call `invalidate()`.
- `debug.ts` installs `window.__BUILDVIEW__` in dev, with `?e2e` or `?diag`. It exposes the *actual* three.js materials, wall bounding boxes (structural meshes only) and ray-cast-verified screen points so Playwright asserts on rendered state.

## API and persistence

- Fastify; every body/params parsed with the shared Zod schemas; validation errors are 400 with field paths.
- `ProjectRepository` interface with two implementations: `PrismaRepository` (PostgreSQL) and `MemoryRepository` (labelled local-dev mode only).
- Tables: `Project` (current document as validated JSON, room dimensions denormalised into columns, `revision`) and `ProjectRevision` (immutable snapshot per save).
- **Optimistic concurrency:** `PUT /api/projects/:id` carries `baseRevision`; the update is a compare-and-set inside a transaction, a stale client gets `409` instead of overwriting newer work.
- Angles/positions are rounded (1e-9 rad / 0.1 mm) so documents survive the JSON/PostgreSQL round trip bit-for-bit.
- Documents are re-validated when read back from the database.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | status and storage backend |
| GET/POST | `/api/projects` | list / create sample project |
| GET/PUT | `/api/projects/:id` | load / save (revisioned) |
| POST | `/api/projects/:id/duplicate` | copy last saved revision |
| GET | `/api/projects/:id/revisions` | revision history |

## Performance decisions

- On-demand rendering; DPR capped by quality level (1.0 / 1.5 / 2.0); shadow-map size and antialiasing per quality; shadows off at "Low".
- Furniture parts are scaled instances of shared geometries; per-model materials are created once and disposed on unmount; wall geometry/outlines/materials are disposed when walls unmount.
- High-frequency drags do not touch history and do not recompute the dirty flag.
- Dev diagnostics overlay: frames/s, draw calls, triangles, geometries, textures, JS heap.
- No post-processing. No external assets yet (everything is procedural), so texture compression is not applicable in this milestone.

## Extension points for later prompts

- **DXF/DWG import**: a worker (new app) parses CAD into `room`/`walls`/`openings`, validated by `SceneDocumentSchema`; `buildRectangularWalls` is the model for a generic polygon-wall builder in `geometry-engine`.
- **Models/materials library**: `FURNITURE_MODELS` is keyed by `FurnitureKind`; glTF loading can replace entries without touching state. `public-assets/` is reserved.
- **Collaboration/approvals**: revisions already exist per save; add users/projects ownership tables.
- **Schema evolution**: `schemaVersion` is in the document; add migrations in `shared` when it changes.
