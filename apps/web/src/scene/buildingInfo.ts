import { bounds, polygonArea, pointInPolygon } from '@buildview/geometry-engine';
import type { Pt, Room, SceneDocument } from '@buildview/shared';

export interface BuildingBounds {
  center: Pt;
  width: number;
  depth: number;
  radius: number;
}

/** Plan-space bounds of everything built (walls, rooms); a small default when the plan is empty. */
export function buildingBounds(doc: Pick<SceneDocument, 'walls' | 'rooms'>): BuildingBounds {
  const pts = [...doc.walls.flatMap((w) => [w.start, w.end]), ...doc.rooms.flatMap((r) => r.polygon)];
  const b = bounds(pts);
  if (!b) return { center: { x: 0, y: 0 }, width: 6, depth: 5, radius: 4 };
  const width = b.max.x - b.min.x;
  const depth = b.max.y - b.min.y;
  return { center: { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 }, width, depth, radius: Math.max(width, depth, 3) / 2 };
}

export function polygonCentroid(poly: readonly Pt[]): Pt {
  const a = polygonArea(poly);
  if (Math.abs(a) < 1e-9) return poly[0] ?? { x: 0, y: 0 };
  let cx = 0;
  let cy = 0;
  poly.forEach((p, i) => {
    const n = poly[(i + 1) % poly.length]!;
    const f = p.x * n.y - n.x * p.y;
    cx += (p.x + n.x) * f;
    cy += (p.y + n.y) * f;
  });
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Where ceiling lights go: one fixture for small rooms, up to four for large ones. */
export function roomLightPoints(room: Room): Pt[] {
  const area = Math.abs(polygonArea(room.polygon));
  const c = polygonCentroid(room.polygon);
  const b = bounds(room.polygon)!;
  const inside = (p: Pt) => pointInPolygon(p, room.polygon);
  if (area < 12) return [inside(c) ? c : room.polygon[0]!];
  const w = b.max.x - b.min.x;
  const d = b.max.y - b.min.y;
  const pts = [-0.25, 0.25].flatMap((fx) => [-0.25, 0.25].map((fy) => ({ x: (b.min.x + b.max.x) / 2 + fx * w, y: (b.min.y + b.max.y) / 2 + fy * d })));
  const ok = pts.filter(inside);
  return ok.length ? ok : [c];
}
