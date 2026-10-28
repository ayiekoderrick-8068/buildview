import type { Pt, Wall } from '@buildview/shared';
import { dist, distToSegment, EPS } from './walls.ts';
import { lineIntersection, polygonArea, segmentIntersection, simplifyPolygon } from './polygon.ts';

interface Edge {
  wallId: string;
  a: number;
  b: number;
  thicknessM: number;
}

export interface DetectedFace {
  /** Interior (inset by half wall thickness) boundary, counter-clockwise. */
  polygon: Pt[];
  wallIds: string[];
}

export interface DanglingEnd {
  wallId: string;
  which: 'start' | 'end';
  point: Pt;
}

export interface Topology {
  faces: DetectedFace[];
  /** Wall ends that touch nothing. */
  danglingEnds: DanglingEnd[];
  /** Faces whose walls were too thick/close to leave interior space. */
  degenerateFaces: number;
  /** Walls that cross another wall's interior without a shared node being an endpoint of either. */
  crossings: Array<{ a: string; b: string; at: Pt }>;
}

/**
 * Wall-graph topology: splits walls at T-junctions and crossings, prunes free ends, then walks the
 * planar graph to find closed faces (rooms). Deterministic for a given wall order and tolerance.
 */
export function analyzeTopology(walls: readonly Wall[], tol = EPS * 5): Topology {
  const nodes: Pt[] = [];
  const nodeOf = (p: Pt): number => {
    const i = nodes.findIndex((n) => dist(n, p) <= tol);
    if (i >= 0) return i;
    nodes.push({ x: p.x, y: p.y });
    return nodes.length - 1;
  };

  const crossings: Topology['crossings'] = [];
  const edges: Edge[] = [];
  for (const w of walls) {
    const len = dist(w.start, w.end);
    if (len <= tol) continue;
    const cuts: Array<{ t: number; p: Pt }> = [
      { t: 0, p: w.start },
      { t: 1, p: w.end },
    ];
    for (const o of walls) {
      if (o.id === w.id) continue;
      for (const p of [o.start, o.end]) {
        if (distToSegment(p, w.start, w.end) <= tol) {
          const t = ((p.x - w.start.x) * (w.end.x - w.start.x) + (p.y - w.start.y) * (w.end.y - w.start.y)) / (len * len);
          if (t > tol / len && t < 1 - tol / len) cuts.push({ t, p });
        }
      }
      const hit = segmentIntersection(w.start, w.end, o.start, o.end);
      if (hit) {
        const interiorOfBoth = hit.t > tol / len && hit.t < 1 - tol / len && hit.u > tol / dist(o.start, o.end) && hit.u < 1 - tol / dist(o.start, o.end);
        if (interiorOfBoth) {
          cuts.push({ t: hit.t, p: hit.p });
          if (w.id < o.id) crossings.push({ a: w.id, b: o.id, at: hit.p });
        }
      }
    }
    cuts.sort((x, y) => x.t - y.t);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = nodeOf(cuts[i]!.p);
      const b = nodeOf(cuts[i + 1]!.p);
      if (a !== b) edges.push({ wallId: w.id, a, b, thicknessM: w.thicknessM });
    }
  }

  // Prune free ends iteratively (and remember them).
  const alive = edges.map(() => true);
  const degree = () => {
    const d = new Array<number>(nodes.length).fill(0);
    edges.forEach((e, i) => {
      if (alive[i]) {
        d[e.a]!++;
        d[e.b]!++;
      }
    });
    return d;
  };
  for (;;) {
    const d = degree();
    let pruned = false;
    edges.forEach((e, i) => {
      if (alive[i] && (d[e.a] === 1 || d[e.b] === 1)) {
        alive[i] = false;
        pruned = true;
      }
    });
    if (!pruned) break;
  }

  const danglingEnds: DanglingEnd[] = [];
  const fullDegree = new Array<number>(nodes.length).fill(0);
  for (const e of edges) {
    fullDegree[e.a]!++;
    fullDegree[e.b]!++;
  }
  for (const w of walls) {
    for (const which of ['start', 'end'] as const) {
      const n = nodeOf(w[which]);
      if (fullDegree[n]! <= 1) danglingEnds.push({ wallId: w.id, which, point: w[which] });
    }
  }

  // Half-edge traversal.
  const live = edges.filter((_, i) => alive[i]);
  const out: Array<Array<{ edge: number; to: number; angle: number }>> = nodes.map(() => []);
  live.forEach((e, i) => {
    const pa = nodes[e.a]!;
    const pb = nodes[e.b]!;
    out[e.a]!.push({ edge: i, to: e.b, angle: Math.atan2(pb.y - pa.y, pb.x - pa.x) });
    out[e.b]!.push({ edge: i, to: e.a, angle: Math.atan2(pa.y - pb.y, pa.x - pb.x) });
  });
  out.forEach((list) => list.sort((x, y) => x.angle - y.angle));

  const used = new Set<string>();
  const key = (edge: number, from: number) => `${edge}:${from}`;
  const faces: DetectedFace[] = [];
  let degenerateFaces = 0;

  live.forEach((e, ei) => {
    for (const startFrom of [e.a, e.b]) {
      if (used.has(key(ei, startFrom))) continue;
      const loop: Array<{ from: number; edge: number }> = [];
      let curEdge = ei;
      let from = startFrom;
      let guard = 0;
      while (!used.has(key(curEdge, from)) && guard++ < live.length * 2 + 4) {
        used.add(key(curEdge, from));
        loop.push({ from, edge: curEdge });
        const le = live[curEdge]!;
        const to = le.a === from ? le.b : le.a;
        const list = out[to]!;
        const idx = list.findIndex((h) => h.edge === curEdge && h.to === from);
        const next = list[(idx - 1 + list.length) % list.length]!;
        from = to;
        curEdge = next.edge;
      }
      const centre = loop.map((h) => nodes[h.from]!);
      if (centre.length < 3) continue;
      const area = polygonArea(centre);
      if (area <= tol) continue; // outer face (negative) or degenerate
      const inset = insetPolygon(centre, loop.map((h) => live[h.edge]!.thicknessM));
      if (!inset || polygonArea(inset) <= tol) {
        degenerateFaces++;
        continue;
      }
      faces.push({ polygon: inset, wallIds: [...new Set(loop.map((h) => live[h.edge]!.wallId))].sort() });
    }
  });

  // Deterministic order: by min x, then min y.
  faces.sort((a, b) => minKey(a.polygon) - minKey(b.polygon) || a.wallIds.join().localeCompare(b.wallIds.join()));
  return { faces, danglingEnds, degenerateFaces, crossings };
}

const minKey = (poly: Pt[]) => Math.min(...poly.map((p) => p.x)) * 1000 + Math.min(...poly.map((p) => p.y));

/** Offsets a CCW centreline polygon inwards by half of each edge's thickness (mitred). */
export function insetPolygon(poly: readonly Pt[], thickness: readonly number[]): Pt[] | null {
  const n = poly.length;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n]!;
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < 1e-9) return null;
    const nx = -(q.y - p.y) / len;
    const ny = (q.x - p.x) / len;
    const off = (thickness[i] ?? 0) / 2;
    return { a: { x: p.x + nx * off, y: p.y + ny * off }, b: { x: q.x + nx * off, y: q.y + ny * off }, n: { x: nx, y: ny }, off };
  });
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i + n - 1) % n];
    const cur = lines[i];
    if (!prev || !cur) return null;
    const hit = lineIntersection(prev.a, prev.b, cur.a, cur.b);
    const base = poly[i]!;
    if (hit && Math.hypot(hit.x - base.x, hit.y - base.y) < 3 * Math.max(prev.off, cur.off, 0.01) * 4) pts.push(hit);
    else pts.push({ x: base.x + cur.n.x * cur.off, y: base.y + cur.n.y * cur.off });
  }
  const simplified = simplifyPolygon(pts);
  return simplified.length >= 3 ? simplified : null;
}
