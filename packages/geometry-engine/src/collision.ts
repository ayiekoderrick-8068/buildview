import type { Opening, Pt, Wall } from '@buildview/shared';
import { wallBoxes, wallExtensions } from './walls.ts';

export interface WalkObstacle {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  cos: number;
  sin: number;
}

/**
 * Plan-space obstacles for first-person walking: every solid wall box that intrudes into the
 * body height band (0.3 m - 1.8 m). Door openings leave a gap, wall segments below windows block.
 */
export function buildWalkObstacles(walls: readonly Wall[], openings: readonly Opening[]): WalkObstacle[] {
  const ext = wallExtensions(walls);
  const out: WalkObstacle[] = [];
  for (const w of walls) {
    for (const b of wallBoxes(w, openings, ext.get(w.id))) {
      const bottom = b.center[1] - b.size[1] / 2;
      const top = b.center[1] + b.size[1] / 2;
      if (bottom >= 1.8 || top <= 0.3) continue;
      // wall-local x axis in plan is (cos, sin) of rotationY; box z is thickness
      out.push({ cx: b.center[0], cy: -b.center[2], hx: b.size[0] / 2, hy: b.size[2] / 2, cos: Math.cos(b.rotationY), sin: Math.sin(b.rotationY) });
    }
  }
  return out;
}

export function circleHitsObstacle(p: Pt, radius: number, o: WalkObstacle): boolean {
  const dx = p.x - o.cx;
  const dy = p.y - o.cy;
  const lx = dx * o.cos + dy * o.sin;
  const ly = -dx * o.sin + dy * o.cos;
  const ex = Math.max(Math.abs(lx) - o.hx, 0);
  const ey = Math.max(Math.abs(ly) - o.hy, 0);
  return ex * ex + ey * ey < radius * radius;
}

/** Moves from `from` towards `to`, sliding along walls when blocked on one axis. */
export function walkStep(from: Pt, to: Pt, radius: number, obstacles: readonly WalkObstacle[]): Pt {
  const blocked = (p: Pt) => obstacles.some((o) => circleHitsObstacle(p, radius, o));
  if (!blocked(to)) return to;
  const slideX = { x: to.x, y: from.y };
  if (!blocked(slideX)) return slideX;
  const slideY = { x: from.x, y: to.y };
  if (!blocked(slideY)) return slideY;
  return from;
}
