import { distToSegment, dist, q } from '@buildview/geometry-engine';
import type { Pt, SceneDocument } from '@buildview/shared';

export interface SnapSettings {
  enabled: boolean;
  gridM: number;
  /** Snap radius in metres (callers convert from screen pixels). */
  radiusM: number;
  endpoints: boolean;
  walls: boolean;
  grid: boolean;
  /** Constrain to horizontal/vertical relative to `from`. */
  ortho: boolean;
}

export type SnapKind = 'endpoint' | 'wall' | 'grid' | 'ortho' | 'none';
export interface SnapResult {
  point: Pt;
  kind: SnapKind;
}

/**
 * Snapping with an explicit radius: a point only moves when a target is within `radiusM`, and the
 * kind of snap applied is returned so the UI can show it. Nothing is rounded outside that radius.
 */
export function snapPoint(doc: SceneDocument, p: Pt, s: SnapSettings, from?: Pt): SnapResult {
  if (!s.enabled) return { point: p, kind: 'none' };
  let best: SnapResult = { point: p, kind: 'none' };
  let bestD = s.radiusM;
  if (s.endpoints) {
    for (const w of doc.walls) {
      for (const e of [w.start, w.end]) {
        const d = dist(p, e);
        if (d <= bestD) {
          bestD = d;
          best = { point: e, kind: 'endpoint' };
        }
      }
    }
  }
  if (best.kind === 'none' && s.walls) {
    let nd = s.radiusM;
    for (const w of doc.walls) {
      const d = distToSegment(p, w.start, w.end);
      if (d <= nd) {
        const dx = w.end.x - w.start.x;
        const dy = w.end.y - w.start.y;
        const t = Math.max(0, Math.min(1, ((p.x - w.start.x) * dx + (p.y - w.start.y) * dy) / (dx * dx + dy * dy)));
        nd = d;
        best = { point: { x: w.start.x + t * dx, y: w.start.y + t * dy }, kind: 'wall' };
      }
    }
  }
  if (best.kind === 'none' && s.grid && s.gridM > 0) {
    const g = { x: q(Math.round(p.x / s.gridM) * s.gridM), y: q(Math.round(p.y / s.gridM) * s.gridM) };
    if (dist(p, g) <= s.radiusM) best = { point: g, kind: 'grid' };
  }
  if (s.ortho && from) {
    const dx = Math.abs(best.point.x - from.x);
    const dy = Math.abs(best.point.y - from.y);
    const point = dx >= dy ? { x: best.point.x, y: from.y } : { x: from.x, y: best.point.y };
    best = { point, kind: best.kind === 'none' ? 'ortho' : best.kind };
  }
  return best;
}
