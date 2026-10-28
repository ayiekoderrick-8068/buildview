# Implementation status (Prompt 1)

Verified on Node 22, Ubuntu 26.04 (WSL2), PostgreSQL 17 (embedded-postgres), headless Chromium with SwiftShader WebGL.

## Verification results

| Check | Result |
| --- | --- |
| `npm run typecheck` (all workspaces + tests/scripts, strict) | pass |
| `npm run lint` | pass (0 errors, 0 warnings) |
| Unit/integration: shared 3, geometry-engine 4, design-engine 14, web 26, API 14 | 61 / 61 pass |
| API suite runs every test against **memory and real PostgreSQL** (via Prisma) | both pass |
| Playwright e2e (real API + PostgreSQL + WebGL) | 8 / 8 pass (+1 screenshot generator, opt-in) |

## Completed and tested

- **Foundation**: npm-workspaces monorepo, strict TypeScript, ESLint, shared Zod contracts, Prisma schema + migration, documented commands.
- **Sample room** 5.0 × 4.0 × 2.8 m, 0.2 m walls; four walls with stable ids (`wall-north|east|south|west`), floor, ceiling, large window (north), internal doorway (south), sofa, coffee table, rug, armchair, TV console, plant, wall art, ceiling downlights - real 3D meshes in the scene (not overlays).
- **Wall painting**: click-select with highlight, id/dimensions/net area/current paint shown, 9 presets + custom picker + hex field, applies to this wall / selected group (Shift-click) / all walls, independent per-wall `MeshStandardMaterial`, dimensions unchanged, undo/redo, dirty flag, persisted on save. *Tests*: design-engine, store, panel, headless scene-graph and Playwright (blue → red → save → reload → red restored from PostgreSQL, rendered wall bounding box unchanged).
- **Material editor**: colour, finish (matte/eggshell/satin/gloss/metallic/plaster), roughness, metalness (enabled only for metallic), texture scale (enabled only for plaster; real bump map), live preview swatch. Inapplicable controls are disabled with an explanation, and the engine also ignores such inputs.
- **Camera**: orbit, zoom, pan (damped, constrained), animated reset and fit, 2D orthographic plan view with dimension labels, 3D perspective, deselect (click empty space / Esc). *Tested*: Playwright asserts the real camera moves for orbit/zoom/pan/reset/fit and that plan mode is orthographic top-down.
- **Furniture**: select, drag along the floor (one undo step per drag), rotate (slider / 15° buttons / `R`), reset, remove optional items and restore them, room-bounds clamp and overlap rejection. Limits are stated in the UI.
- **Lighting**: daylight / warm evening, ambient, sun intensity, interior lights toggle; Playwright asserts the rendered canvas actually changes.
- **Persistence**: create sample project, save with optimistic concurrency (`409` on stale revision), reload, duplicate (saves pending edits first), revision history table, validation errors (400), unsaved / saving / saved / failed indicators, failed saves never reported as saved.
- **Performance basics**: on-demand rendering, DPR and shadow quality levels, shared furniture geometries, disposal of wall geometry/materials/textures, dev diagnostics overlay (`?diag` in production builds).

## Incomplete, simplified or not verified

- **Reference image**: not available in the session; UI built from the written description and should be compared against the image.
- **Not implemented** (visibly disabled or absent in the UI): Build and Experience workspaces, Décor and Exterior tools, walkthrough, alternative designs, **Render** (the viewport is a real-time preview, not an offline/ray-traced render), DXF/DWG import, 2D floor-plan *editing*, accounts/collaboration/approval, AI features. None are claimed.
- "2D plan" is an orthographic top-down view of the 3D scene with dimension labels; it is not a CAD drawing editor.
- Furniture is original procedural low-poly geometry, not realistic licensed models; no texture/model compression was needed because there are no external assets yet.
- One material per wall (both faces). Floor/ceiling materials exist in the document but have no editing UI.
- Collision is bounding-box only (room bounds + overlap). No clearances, door swings or accessibility checks.
- Undo history is in-memory per session (not persisted); every save adds a revision row (no pruning/restore UI yet).
- **Not measured**: real-GPU frame rates, memory growth over long sessions, large-scene behaviour. Playwright ran on a software rasteriser, so numbers from it say nothing about user hardware. The quality presets and diagnostics overlay exist to measure this next.
- No automated visual-regression tests, no cross-browser runs (Chromium only), no automated accessibility audit; keyboard focus styles are implemented but a screen-reader pass was not done.
- Auth and rate limiting are absent; the API is intended for local development in this milestone.
- The embedded PostgreSQL is for development only; production database provisioning/backups are not set up.
