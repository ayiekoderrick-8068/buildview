# Roadmap and recommended next steps

## Recommended for Prompt 2

1. **2D floor plan model & editor** - generalise `buildRectangularWalls` to arbitrary closed wall polygons with
   corner mitring, add a true 2D drawing surface (snap, dimension editing, add/remove openings), still emitting the
   existing `SceneDocument` contract.
2. **DXF import (not DWG yet)** - a worker that parses DXF LINE/LWPOLYLINE/ARC/INSERT layers into walls and openings
   with an explicit *review & verify* step before conversion. DWG needs a licensed/converted pipeline (e.g. ODA)
   - decide that deliberately; do not claim DWG support until validated on real drawings.
3. **Asset pipeline** - glTF furniture with Draco/Meshopt + KTX2 textures into `public-assets/`, swapped in via
   `FURNITURE_MODELS`; PBR floor/wall texture sets in the material editor.
4. **Per-face wall materials** - interior vs exterior face and per-room assignment (currently one material per wall).
5. **Projects UI** - project list/open/rename/delete, revision browser and restore (API already stores revisions).

## Later

- First-person walkthrough with collision against walls/furniture.
- Auth, ownership, sharing and client approval workflow; comments pinned to walls/objects.
- Rendered stills (server-side, GPU worker) - the in-app viewport is a real-time preview, not a ray-traced render.
- AI-assisted layout/style suggestions operating on the same document contract (propose a patch, user approves).
- Real-estate presentation mode (shareable read-only link, guided tour).
- Accessibility pass on the 3D viewport (keyboard camera control, screen-reader summaries of the scene).
- Observability: structured API logging is on; add metrics and error reporting.
