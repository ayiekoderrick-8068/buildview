import type { Pt } from '@buildview/shared';

/** Signed area; positive for counter-clockwise polygons. */
export function polygonArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const n = poly[(i + 1) % poly.length]!;
    a += p.x * n.y - n.x * p.y;
  }
  return a / 2;
}

export function pointInPolygon(p: Pt, poly: readonly Pt[], tol = 1e-6): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    // on-edge counts as inside
    const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0 && Math.abs(cross) / len <= tol && Math.min(a.x, b.x) - tol <= p.x && p.x <= Math.max(a.x, b.x) + tol && Math.min(a.y, b.y) - tol <= p.y && p.y <= Math.max(a.y, b.y) + tol) {
      return true;
    }
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface SegHit {
  /** Parameter along segment 1 and 2 in [0, 1]. */
  t: number;
  u: number;
  p: Pt;
}

/** Proper or touching intersection of segments a-b and c-d, or null for parallel/disjoint. */
export function segmentIntersection(a: Pt, b: Pt, c: Pt, d: Pt): SegHit | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, p: { x: a.x + t * rx, y: a.y + t * ry } };
}

/** Intersection of the infinite lines through a-b and c-d, or null when (nearly) parallel. */
export function lineIntersection(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  return { x: a.x + t * rx, y: a.y + t * ry };
}

/** True when any two non-adjacent edges cross. */
export function isSelfIntersecting(poly: readonly Pt[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const hit = segmentIntersection(poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!);
      if (hit) return true;
    }
  }
  return false;
}

export function bounds(points: readonly Pt[]): { min: Pt; max: Pt } | null {
  if (points.length === 0) return null;
  const min = { x: Infinity, y: Infinity };
  const max = { x: -Infinity, y: -Infinity };
  for (const p of points) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
  }
  return { min, max };
}

/** Convex hull (Andrew's monotone chain), counter-clockwise. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Removes consecutive duplicate and collinear vertices. */
export function simplifyPolygon(poly: readonly Pt[], tol = 1e-6): Pt[] {
  let pts = [...poly];
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i + pts.length - 1) % pts.length]!;
      const cur = pts[i]!;
      const next = pts[(i + 1) % pts.length]!;
      const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
      if (Math.hypot(cur.x - prev.x, cur.y - prev.y) < tol || Math.abs(cross) < tol) {
        pts = pts.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}
