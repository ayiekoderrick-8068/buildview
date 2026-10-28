import { createRectangularHouse } from '@buildview/geometry-engine';
import {
  SCHEMA_VERSION,
  ceilingSurfaceId,
  floorSurfaceId,
  materialFromFinish,
  type FurnitureItem,
  type SceneDocument,
  type Vec2,
} from '@buildview/shared';
import { normalizeAngle } from './operations.ts';

/**
 * Angles are stored rounded to 1e-9 rad so they survive a JSON/PostgreSQL round trip bit-for-bit
 * (full-precision doubles such as PI/2 lose their last digit in some JSON encoders).
 */
function item(
  partial: Omit<FurnitureItem, 'home' | 'deleted' | 'elevation'> & { elevation?: number },
): FurnitureItem {
  const rotationY = normalizeAngle(partial.rotationY);
  return { elevation: 0, deleted: false, ...partial, rotationY, home: { position: partial.position, rotationY } };
}

const DEFAULT_LIGHTING: SceneDocument['lighting'] = { preset: 'daylight', ambient: 1, sun: 1, interior: true };

/** Adds default materials for every wall / room surface that has none. Existing materials are never touched. */
export function ensureSurfaces(doc: SceneDocument): SceneDocument {
  const surfaces = { ...doc.surfaces };
  let changed = false;
  const need = (id: string, make: () => SceneDocument['surfaces'][string]) => {
    if (!surfaces[id]) {
      surfaces[id] = make();
      changed = true;
    }
  };
  for (const w of doc.walls) need(w.id, () => materialFromFinish('#F1EEE6', 'matte'));
  for (const r of doc.rooms) {
    need(floorSurfaceId(r.id), () => ({ ...materialFromFinish('#8A6A4B', 'satin'), roughness: 0.55 }));
    need(ceilingSurfaceId(r.id), () => materialFromFinish('#FAF8F3', 'matte'));
  }
  if (doc.roof) need('roof', () => materialFromFinish('#6E6E70', 'matte'));
  return changed ? { ...doc, surfaces } : doc;
}

/** Empty single-storey project to draw in or import a drawing into. */
export function createBlankDocument(): SceneDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    levels: [{ id: 'LEVEL-001', name: 'Ground floor', elevationM: 0, heightM: 2.8 }],
    walls: [],
    openings: [],
    rooms: [],
    roof: null,
    surfaces: {},
    furniture: [],
    lighting: DEFAULT_LIGHTING,
    sources: [],
    acknowledgedIssues: [],
    approval: { status: 'draft', approvedAt: null },
  };
}

/** Fictional sample living room. Dimensions are not sourced from any CAD drawing. */
export function createSampleDocument(): SceneDocument {
  const lengthM = 5.0;
  const widthM = 4.0;
  const t = 0.2;
  const hx = lengthM / 2 + t / 2;
  const geometry = createRectangularHouse(
    { lengthM, widthM, heightM: 2.8, wallThicknessM: t },
    {
      north: [{ id: 'window-main', kind: 'window', offsetM: hx, widthM: 2.4, heightM: 1.9, sillM: 0.5 }],
      south: [{ id: 'doorway-hall', kind: 'doorway', offsetM: hx - 1.5, widthM: 0.9, heightM: 2.1, sillM: 0 }],
    },
  );
  const pos = (x: number, y: number): Vec2 => [x, y];
  const furniture: FurnitureItem[] = [
    item({ id: 'rug-main', kind: 'rug', name: 'Area rug', position: pos(0.6, 0), rotationY: 0, size: [3.0, 0.02, 2.0], movable: true, removable: true }),
    item({ id: 'sofa-main', kind: 'sofa', name: 'Sofa', position: pos(2.0, 0), rotationY: -Math.PI / 2, size: [2.2, 0.85, 0.95], movable: true, removable: false }),
    item({ id: 'coffee-table', kind: 'coffee-table', name: 'Coffee table', position: pos(0.7, 0), rotationY: 0, size: [1.1, 0.42, 0.6], movable: true, removable: false }),
    item({ id: 'armchair-main', kind: 'armchair', name: 'Armchair', position: pos(-0.7, 1.3), rotationY: 0, size: [0.85, 0.85, 0.85], movable: true, removable: true }),
    item({ id: 'tv-console', kind: 'tv-console', name: 'TV console', position: pos(-2.28, 0), rotationY: Math.PI / 2, size: [1.6, 1.0, 0.4], movable: true, removable: false }),
    item({ id: 'plant-main', kind: 'plant', name: 'Indoor plant', position: pos(-2.1, 1.6), rotationY: 0, size: [0.5, 1.3, 0.5], movable: true, removable: true }),
    item({ id: 'wall-art-main', kind: 'wall-art', name: 'Wall art', position: pos(2.47, 0), rotationY: -Math.PI / 2, size: [1.2, 0.8, 0.05], elevation: 1.2, movable: false, removable: true }),
  ];
  const base: SceneDocument = {
    ...createBlankDocument(),
    ...geometry,
    furniture,
  };
  const doc = ensureSurfaces(base);
  return { ...doc, surfaces: { ...doc.surfaces, 'wall-east': materialFromFinish('#9CAF88', 'matte') } };
}
