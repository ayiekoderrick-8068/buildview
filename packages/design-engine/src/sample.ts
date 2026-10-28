import { buildRectangularWalls } from '@buildview/geometry-engine';
import { normalizeAngle } from './operations.ts';
import {
  CEILING_SURFACE_ID,
  FLOOR_SURFACE_ID,
  SCHEMA_VERSION,
  materialFromFinish,
  type FurnitureItem,
  type Room,
  type SceneDocument,
  type Vec2,
} from '@buildview/shared';

export const SAMPLE_ROOM: Room = { length: 5.0, width: 4.0, height: 2.8, wallThickness: 0.2 };

/**
 * Angles are stored rounded to 1e-9 rad so they survive a JSON/PostgreSQL round trip bit-for-bit
 * (full-precision doubles such as PI/2 lose their last digit in some JSON encoders).
 */
function item(
  partial: Omit<FurnitureItem, 'home' | 'deleted' | 'elevation'> & { elevation?: number },
): FurnitureItem {
  const rotationY = normalizeAngle(partial.rotationY);
  return {
    elevation: 0,
    deleted: false,
    ...partial,
    rotationY,
    home: { position: partial.position, rotationY },
  };
}

/** Fictional sample living room. Dimensions are not sourced from any CAD drawing. */
export function createSampleDocument(): SceneDocument {
  const room = SAMPLE_ROOM;
  const hl = room.length / 2;

  const walls = buildRectangularWalls(room, {
    north: [
      // Large window centred on the north wall.
      { id: 'window-main', kind: 'window', offset: room.length / 2, width: 2.4, height: 1.9, sill: 0.5 },
    ],
    south: [
      // Internal doorway towards the rest of the house.
      { id: 'doorway-hall', kind: 'doorway', offset: hl - 1.5, width: 0.9, height: 2.1, sill: 0 },
    ],
  });

  const surfaces: SceneDocument['surfaces'] = {};
  for (const wall of walls) surfaces[wall.id] = materialFromFinish('#F1EEE6', 'matte');
  surfaces['wall-east'] = materialFromFinish('#9CAF88', 'matte');
  surfaces[FLOOR_SURFACE_ID] = { ...materialFromFinish('#8A6A4B', 'satin'), roughness: 0.55 };
  surfaces[CEILING_SURFACE_ID] = materialFromFinish('#FAF8F3', 'matte');

  const pos = (x: number, z: number): Vec2 => [x, z];
  const furniture: FurnitureItem[] = [
    item({ id: 'rug-main', kind: 'rug', name: 'Area rug', position: pos(0.6, 0), rotationY: 0, size: [3.0, 0.02, 2.0], movable: true, removable: true }),
    item({ id: 'sofa-main', kind: 'sofa', name: 'Sofa', position: pos(2.0, 0), rotationY: -Math.PI / 2, size: [2.2, 0.85, 0.95], movable: true, removable: false }),
    item({ id: 'coffee-table', kind: 'coffee-table', name: 'Coffee table', position: pos(0.7, 0), rotationY: 0, size: [1.1, 0.42, 0.6], movable: true, removable: false }),
    item({ id: 'armchair-main', kind: 'armchair', name: 'Armchair', position: pos(-0.7, -1.3), rotationY: 0, size: [0.85, 0.85, 0.85], movable: true, removable: true }),
    item({ id: 'tv-console', kind: 'tv-console', name: 'TV console', position: pos(-2.28, 0), rotationY: Math.PI / 2, size: [1.6, 1.0, 0.4], movable: true, removable: false }),
    item({ id: 'plant-main', kind: 'plant', name: 'Indoor plant', position: pos(-2.1, -1.6), rotationY: 0, size: [0.5, 1.3, 0.5], movable: true, removable: true }),
    item({ id: 'wall-art-main', kind: 'wall-art', name: 'Wall art', position: pos(2.47, 0), rotationY: -Math.PI / 2, size: [1.2, 0.8, 0.05], elevation: 1.2, movable: false, removable: true }),
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    room,
    walls,
    surfaces,
    furniture,
    lighting: { preset: 'daylight', ambient: 1, sun: 1, interior: true },
  };
}
