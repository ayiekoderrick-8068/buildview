import type { FurnitureItem, Room, Vec2 } from '@buildview/shared';

/**
 * Basic floor placement checks: axis-aligned bounding boxes of rotated footprints.
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

export function clampToRoom(room: Room, f: Footprint): Vec2 {
  const [hx, hz] = halfExtents(f);
  const maxX = Math.max(0, room.length / 2 - hx);
  const maxZ = Math.max(0, room.width / 2 - hz);
  return [clamp(f.position[0], -maxX, maxX), clamp(f.position[1], -maxZ, maxZ)];
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
 * Resolves a requested floor position: clamps to the room, then rejects positions that overlap
 * another solid item (falling back to sliding along a single axis, then to the previous position).
 */
export function resolveFurniturePosition(
  room: Room,
  item: FurnitureItem,
  others: readonly FurnitureItem[],
  requested: Vec2,
  rotationY: number = item.rotationY,
): Vec2 {
  const solid = isSolidObstacle(item);
  const blockers = others.filter((o) => o.id !== item.id && isSolidObstacle(o));
  const test = (pos: Vec2): boolean => {
    const fp: Footprint = { position: pos, rotationY, size: item.size };
    if (!solid) return true;
    return !blockers.some((o) => footprintsOverlap(fp, o));
  };

  const clamped = clampToRoom(room, { position: requested, rotationY, size: item.size });
  if (test(clamped)) return clamped;
  const slideX: Vec2 = [clamped[0], item.position[1]];
  if (test(slideX)) return slideX;
  const slideZ: Vec2 = [item.position[0], clamped[1]];
  if (test(slideZ)) return slideZ;
  return item.position;
}

/** True when rotating in place would leave the room or hit another solid item. */
export function canRotateTo(
  room: Room,
  item: FurnitureItem,
  others: readonly FurnitureItem[],
  rotationY: number,
): boolean {
  const fp: Footprint = { position: item.position, rotationY, size: item.size };
  const [hx, hz] = halfExtents(fp);
  if (Math.abs(item.position[0]) + hx > room.length / 2 + 1e-6) return false;
  if (Math.abs(item.position[1]) + hz > room.width / 2 + 1e-6) return false;
  if (!isSolidObstacle(item)) return true;
  return !others.some((o) => o.id !== item.id && isSolidObstacle(o) && footprintsOverlap(fp, o));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
