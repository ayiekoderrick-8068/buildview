import { describe, expect, it } from 'vitest';
import type { SceneDocument, Wall } from '@buildview/shared';
import { analyzeTopology, validateDocument, wallBoxes, wallExtensions, LEVEL_ID } from '../src/index.ts';

/** A rows x cols grid of 4 x 3 m rooms: (rows+1)*cols + (cols+1)*rows wall segments. */
function gridPlan(rows: number, cols: number): SceneDocument {
  const walls: Wall[] = [];
  const w = (id: string, x0: number, y0: number, x1: number, y1: number): Wall => ({ id, levelId: LEVEL_ID, name: id, start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thicknessM: 0.2, heightM: 2.8, sourceHandles: [], verificationStatus: 'manual', notes: [] });
  for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) walls.push(w(`H-${r}-${c}`, c * 4, r * 3, (c + 1) * 4, r * 3));
  for (let c = 0; c <= cols; c++) for (let r = 0; r < rows; r++) walls.push(w(`V-${c}-${r}`, c * 4, r * 3, c * 4, (r + 1) * 3));
  return {
    schemaVersion: 2,
    levels: [{ id: LEVEL_ID, name: 'Ground', elevationM: 0, heightM: 2.8 }],
    walls,
    openings: [],
    rooms: [],
    roof: null,
    surfaces: {},
    furniture: [],
    lighting: { preset: 'daylight', ambient: 1, sun: 1, interior: true },
    sources: [],
    acknowledgedIssues: [],
    approval: { status: 'draft', approvedAt: null },
  };
}

describe('geometry pipeline scales to larger plans', () => {
  it('analyses a ~200-wall, 100-room floor quickly and correctly', () => {
    const doc = gridPlan(10, 10); // 220 walls
    expect(doc.walls).toHaveLength(220);
    const t0 = performance.now();
    const topo = analyzeTopology(doc.walls);
    const t1 = performance.now();
    const issues = validateDocument(doc);
    const t2 = performance.now();
    const ext = wallExtensions(doc.walls);
    const boxes = doc.walls.flatMap((x) => wallBoxes(x, doc.openings, ext.get(x.id)));
    const t3 = performance.now();
    console.log(`[perf] 220 walls: topology ${(t1 - t0).toFixed(0)} ms, validation ${(t2 - t1).toFixed(0)} ms, wall boxes ${(t3 - t2).toFixed(0)} ms`);
    expect(topo.faces).toHaveLength(100); // every cell found as a room
    expect(topo.faces.every((f) => Math.abs(Math.abs(areaOf(f.polygon)) - 3.8 * 2.8) < 1e-6)).toBe(true);
    expect(issues.filter((i) => i.severity === 'critical')).toEqual([]);
    expect(boxes).toHaveLength(220);
    // generous ceilings: they only catch accidental O(n^3) regressions, not slow machines
    expect(t1 - t0).toBeLessThan(5000);
    expect(t2 - t1).toBeLessThan(10000);
  });
});

function areaOf(p: Array<{ x: number; y: number }>) {
  return p.reduce((a, pt, i) => a + (pt.x * p[(i + 1) % p.length]!.y - p[(i + 1) % p.length]!.x * pt.y), 0) / 2;
}
