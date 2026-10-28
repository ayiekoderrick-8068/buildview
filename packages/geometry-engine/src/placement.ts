import type { FurnitureItem, Pt, Room, Vec2 } from '@buildview/shared';
import { pointInPolygon } from './polygon.ts';

/**
 * Basic floor placement checks. Footprints are checked against room polygons (all four corners
 * must be inside one room) and against each other (axis-aligned boxes of rotated footprints).
 * This is NOT architectural collision analysis (no clearances, door swings, egress paths).
 */

export interface Footprint {
  position: Vec2;
  rotationY: number;
  size: FurnitureItem['size'];
}

export function halfExtents(f: Pick<Footprint, 'rotationY' | 'size'>): Vec2 {
  const c = Math.abs(Math.cos(f.rotationY));
  const s = Math.abs(Math.sin(f.rotationY));
  const [w, , d] = f.size;
  return [(c * w + s * d) / 2, (s * w + c * d) / 2];
}

/** Plan-space corners of the footprint (plan y = north = -world z). */
export function footprintCorners(f: Footprint): Pt[] {
  const [w, , d] = f.size;
  const c = Math.cos(f.rotationY);
  const s = Math.sin(f.rotationY);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sz]) => {
    const lx = (sx * w) / 2;
    const lz = (sz * d) / 2;
    return { x: f.position[0] + lx * c + lz * s, y: f.position[1] + lx * s - lz * c };
  });
}

export function footprintInsideRooms(f: Footprint, rooms: readonly Room[], tol = 1e-4): boolean {
  if (rooms.length === 0) return true; // nothing to constrain against yet
  const corners = footprintCorners(f);
  return rooms.some((r) => corners.every((c) => pointInPolygon(c, r.polygon, tol)));
}

export function footprintsOverlap(a: Footprint, b: Footprint): boolean {
  const [ax, az] = halfExtents(a);
  const [bx, bz] = halfExtents(b);
  return (
    Math.abs(a.position[0] - b.position[0]) < ax + bx - 1e-6 &&
    Math.abs(a.position[1] - b.position[1]) < az + bz - 1e-6
  );
}

/** Items that sit on the floor and never block others (rugs) or hang on walls (art). */
export function isSolidObstacle(item: FurnitureItem): boolean {
  return !item.deleted && item.kind !== 'rug' && item.kind !== 'wall-art';
}

/**
 * Resolves a requested floor position: the request if valid, otherwise sliding along one axis,
 * otherwise the previous position. "Valid" = inside a room and not overlapping another solid item.
 */
export function resolveFurniturePosition(
  rooms: readonly Room[],
  item: FurnitureItem,
  others: readonly FurnitureItem[],
  requested: Vec2,
  rotationY: number = item.rotationY,
): Vec2 {
  const solid = isSolidObstacle(item);
  const blockers = others.filter((o) => o.id !== item.id && isSolidObstacle(o));
  const valid = (pos: Vec2): boolean => {
    const fp: Footprint = { position: pos, rotationY, size: item.size };
    if (!footprintInsideRooms(fp, rooms)) return false;
    return !solid || !blockers.some((o) => footprintsOverlap(fp, o));
  };
  if (valid(requested)) return requested;
  const slideX: Vec2 = [requested[0], item.position[1]];
  if (valid(slideX)) return slideX;
  const slideY: Vec2 = [item.position[0], requested[1]];
  if (valid(slideY)) return slideY;
  return item.position;
}

/** True when rotating in place would leave the room or hit another solid item. */
export function canRotateTo(
  rooms: readonly Room[],
  item: FurnitureItem,
  others: readonly FurnitureItem[],
  rotationY: number,
): boolean {
  const fp: Footprint = { position: item.position, rotationY, size: item.size };
  if (!footprintInsideRooms(fp, rooms)) return false;
  if (!isSolidObstacle(item)) return true;
  return !others.some((o) => o.id !== item.id && isSolidObstacle(o) && footprintsOverlap(fp, o));
}
