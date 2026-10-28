import type { CadParseResult, Opening, Pt, Room, SceneDocument, SourceRef, Wall } from '@buildview/shared';
import { analyzeTopology } from './topology.ts';
import { lineIntersection, polygonArea } from './polygon.ts';
import { dist, distToSegment, EPS, LEVEL_ID, q, wallDirection } from './walls.ts';

export type LayerCategory = 'wall' | 'door' | 'window' | 'room' | 'ignore';
export type SourceIssue = SourceRef['issues'][number];

export interface RecognitionOptions {
  /** Drawing units -> metres. Must be the architect-confirmed value, never guessed. */
  toMetres: number;
  layerMap: Record<string, LayerCategory>;
  /** "centerline": each wall is one line. "double-line": walls are pairs of parallel lines. */
  wallMode: 'centerline' | 'double-line';
  /** Thickness used for centreline walls (not stored in the drawing, so it is an assumption). */
  defaultThicknessM: number;
  wallHeightM: number;
  /** Endpoints closer than this to another wall are joined automatically (reported if > EPS). */
  closeGapM: number;
  doubleLine: { minThicknessM: number; maxThicknessM: number };
  door: { heightM: number; sillM: number };
  window: { heightM: number; sillM: number };
}

export const DEFAULT_RECOGNITION: Omit<RecognitionOptions, 'toMetres' | 'layerMap'> = {
  wallMode: 'centerline',
  defaultThicknessM: 0.2,
  wallHeightM: 2.8,
  closeGapM: 0.02,
  doubleLine: { minThicknessM: 0.05, maxThicknessM: 0.5 },
  door: { heightM: 2.1, sillM: 0 },
  window: { heightM: 1.2, sillM: 0.9 },
};

export function suggestLayerMap(layers: readonly string[]): Record<string, LayerCategory> {
  const out: Record<string, LayerCategory> = {};
  for (const l of layers) {
    if (/wall|mur|w[-_]?wall/i.test(l)) out[l] = 'wall';
    else if (/door|porte/i.test(l)) out[l] = 'door';
    else if (/wind|glaz|fenetre|window/i.test(l)) out[l] = 'window';
    else if (/room|space|area|zone|piece/i.test(l)) out[l] = 'room';
    else out[l] = 'ignore';
  }
  return out;
}

export interface RecognitionResult {
  parts: Pick<SceneDocument, 'levels' | 'walls' | 'openings' | 'rooms'>;
  originM: Pt;
  issues: SourceIssue[];
  stats: { segments: number; duplicatesRemoved: number; walls: number; openings: number; rooms: number; gapsClosed: number };
}

interface Seg {
  a: Pt;
  b: Pt;
  handles: string[];
  approximated: boolean;
}

const rad = (d: number) => (d * Math.PI) / 180;

function arcPoints(center: Pt, r: number, startDeg: number, endDeg: number): Pt[] {
  let sweep = endDeg - startDeg;
  while (sweep <= 0) sweep += 360;
  const n = Math.max(2, Math.ceil(sweep / 15));
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: center.x + r * Math.cos(rad(startDeg + (sweep * i) / n)),
    y: center.y + r * Math.sin(rad(startDeg + (sweep * i) / n)),
  }));
}

function bulgePoints(p: Pt, qq: Pt, bulge: number): Pt[] {
  const theta = 4 * Math.atan(bulge);
  const chord = dist(p, qq);
  if (chord < 1e-9 || Math.abs(theta) < 1e-6) return [p, qq];
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mid = { x: (p.x + qq.x) / 2, y: (p.y + qq.y) / 2 };
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  const side = bulge > 0 ? 1 : -1;
  const nx = (-(qq.y - p.y) / chord) * side;
  const ny = ((qq.x - p.x) / chord) * side;
  const sign = Math.abs(theta) > Math.PI ? -1 : 1;
  const c = { x: mid.x + nx * h * sign, y: mid.y + ny * h * sign };
  const a0 = Math.atan2(p.y - c.y, p.x - c.x);
  const n = Math.max(2, Math.ceil(Math.abs(theta) / rad(15)));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + (theta * i) / n;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

/**
 * Deterministic CAD -> architectural recognition. No AI, no guessing of scale: every assumption
 * (thickness, opening heights, auto-closed gaps, approximated curves) is recorded as an issue and
 * flags the affected element for review.
 */
export function recognizeBuilding(cad: CadParseResult, opts: RecognitionOptions): RecognitionResult {
  const issues: SourceIssue[] = [];
  const k = opts.toMetres;
  const cat = (layer: string): LayerCategory => opts.layerMap[layer] ?? 'ignore';
  const P = (p: readonly [number, number]): Pt => ({ x: p[0] * k, y: p[1] * k });

  const annotation = new Set(['TEXT', 'MTEXT', 'DIMENSION', 'LEADER', 'MLEADER', 'ATTRIB', 'ATTDEF', 'HATCH', 'POINT', 'VIEWPORT']);
  for (const u of cad.unsupported) {
    issues.push({ code: 'unsupported-entity', severity: annotation.has(u.type) ? 'info' : 'warning', message: `${u.count} ${u.type} entit${u.count === 1 ? 'y was' : 'ies were'} not interpreted (unsupported type).`, sourceHandles: u.sampleHandles.slice(0, 8) });
  }
  for (const w of cad.warnings) issues.push({ code: 'parser-warning', severity: 'info', message: w, sourceHandles: [] });
  if (cad.truncated) issues.push({ code: 'drawing-truncated', severity: 'critical', message: 'The drawing exceeded the entity limit and was truncated; the plan is incomplete.', sourceHandles: [] });

  // ---- 1. wall line work
  let segs: Seg[] = [];
  const roomPolys: Array<{ pts: Pt[]; handle: string }> = [];
  for (const e of cad.entities) {
    const c = cat(e.layer);
    if (c === 'wall') {
      if (e.type === 'LINE') segs.push({ a: P(e.a), b: P(e.b), handles: [e.handle], approximated: false });
      else if (e.type === 'POLYLINE') {
        const pts = e.points;
        const count = e.closed ? pts.length : pts.length - 1;
        for (let i = 0; i < count; i++) {
          const p = pts[i]!;
          const n = pts[(i + 1) % pts.length]!;
          const curved = Math.abs(p[2]) > 1e-9;
          const run = curved ? bulgePoints(P([p[0], p[1]]), P([n[0], n[1]]), p[2]) : [P([p[0], p[1]]), P([n[0], n[1]])];
          for (let j = 0; j + 1 < run.length; j++) segs.push({ a: run[j]!, b: run[j + 1]!, handles: [e.handle], approximated: curved });
        }
      } else if (e.type === 'ARC') {
        const pts = arcPoints(P(e.center), e.radius * k, e.startDeg, e.endDeg);
        for (let j = 0; j + 1 < pts.length; j++) segs.push({ a: pts[j]!, b: pts[j + 1]!, handles: [e.handle], approximated: true });
      } else {
        issues.push({ code: 'circle-on-wall-layer', severity: 'info', message: 'A circle on a wall layer was ignored.', sourceHandles: [e.handle] });
      }
    } else if (c === 'room' && e.type === 'POLYLINE' && e.closed && e.points.length >= 3 && e.points.every((p) => Math.abs(p[2]) < 1e-9)) {
      roomPolys.push({ pts: e.points.map((p) => P([p[0], p[1]])), handle: e.handle });
    }
  }
  const before = segs.length;
  segs = segs.filter((s) => dist(s.a, s.b) > EPS);
  if (segs.length < before) issues.push({ code: 'zero-length-lines', severity: 'info', message: `${before - segs.length} zero-length wall line(s) ignored.`, sourceHandles: [] });

  // ---- 2. duplicates (mm resolution)
  const seen = new Map<string, Seg>();
  let duplicatesRemoved = 0;
  for (const s of segs) {
    const ka = `${Math.round(s.a.x * 1000)},${Math.round(s.a.y * 1000)}`;
    const kb = `${Math.round(s.b.x * 1000)},${Math.round(s.b.y * 1000)}`;
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const prev = seen.get(key);
    if (prev) {
      prev.handles.push(...s.handles);
      duplicatesRemoved++;
    } else seen.set(key, s);
  }
  segs = [...seen.values()];
  if (duplicatesRemoved > 0) issues.push({ code: 'duplicate-lines', severity: 'info', message: `${duplicatesRemoved} duplicate wall line(s) were merged.`, sourceHandles: [] });

  // ---- 3. origin (centre of wall bbox, rounded to cm) keeps coordinates small for rendering
  const all = segs.flatMap((s) => [s.a, s.b]);
  const originM: Pt = all.length
    ? { x: Math.round(((Math.min(...all.map((p) => p.x)) + Math.max(...all.map((p) => p.x))) / 2) * 100) / 100, y: Math.round(((Math.min(...all.map((p) => p.y)) + Math.max(...all.map((p) => p.y))) / 2) * 100) / 100 }
    : { x: 0, y: 0 };
  const shift = (p: Pt): Pt => ({ x: q(p.x - originM.x), y: q(p.y - originM.y) });
  segs = segs.map((s) => ({ ...s, a: shift(s.a), b: shift(s.b) }));

  // ---- 4. segments -> wall candidates
  type Cand = { start: Pt; end: Pt; thicknessM: number; handles: string[]; flags: string[] };
  let cands: Cand[] = [];
  if (opts.wallMode === 'centerline') {
    cands = segs.map((s) => ({ start: s.a, end: s.b, thicknessM: opts.defaultThicknessM, handles: s.handles, flags: s.approximated ? ['Curved wall approximated by straight segments.'] : [] }));
    if (cands.length) issues.push({ code: 'thickness-assumed', severity: 'info', message: `Wall thickness is not stored in a centreline drawing; ${opts.defaultThicknessM} m was assumed for all walls.`, sourceHandles: [] });
  } else {
    const r = pairDoubleLines(segs, opts.doubleLine.minThicknessM, opts.doubleLine.maxThicknessM);
    cands = r.walls;
    if (r.unpaired.length) issues.push({ code: 'unpaired-wall-lines', severity: 'warning', message: `${r.unpaired.length} wall line(s) had no parallel partner within ${opts.doubleLine.minThicknessM}-${opts.doubleLine.maxThicknessM} m and were ignored.`, sourceHandles: r.unpaired.flatMap((s) => s.handles).slice(0, 16) });
  }

  // ---- 5. merge collinear continuations, then close small gaps
  cands = mergeCollinear(cands);
  const closeLog: Array<{ i: number; d: number }> = [];
  closeGaps(cands, opts, closeLog);
  if (closeLog.length) {
    issues.push({ code: 'gaps-closed', severity: 'info', message: `${closeLog.length} wall end(s) were extended/trimmed to meet the adjoining wall (largest ${(Math.max(...closeLog.map((c) => c.d)) * 1000).toFixed(0)} mm).`, sourceHandles: closeLog.flatMap((c) => cands[c.i]!.handles).slice(0, 16) });
    for (const c of closeLog) cands[c.i]!.flags.push(`Endpoint moved ${(c.d * 1000).toFixed(0)} mm to close a gap.`);
  }

  // ---- 6. deterministic ids
  cands.sort((x, y) => key4(x) - key4(y) || x.handles.join().localeCompare(y.handles.join()));
  const walls: Wall[] = cands.map((c, i) => ({
    id: `WALL-${String(i + 1).padStart(3, '0')}`,
    levelId: LEVEL_ID,
    name: `Wall ${i + 1}`,
    start: { x: q(c.start.x), y: q(c.start.y) },
    end: { x: q(c.end.x), y: q(c.end.y) },
    thicknessM: q(c.thicknessM),
    heightM: opts.wallHeightM,
    sourceHandles: [...new Set(c.handles)].slice(0, 64),
    verificationStatus: c.flags.length ? 'needs-review' : 'detected',
    notes: c.flags.slice(0, 8),
  }));

  // ---- 7. openings from block inserts
  const openings: Opening[] = [];
  const placed: Array<Omit<Opening, 'id'> & { sortKey: string }> = [];
  for (const ins of cad.inserts) {
    const c = cat(ins.layer);
    if (c !== 'door' && c !== 'window') continue;
    if (ins.handle.includes('/')) continue; // nested block: the outermost INSERT represents the opening
    if (!ins.bbox) {
      issues.push({ code: 'insert-no-geometry', severity: 'warning', message: `Block "${ins.name}" has no measurable geometry; the opening was skipped.`, sourceHandles: [ins.handle] });
      continue;
    }
    const at = shift(P(ins.at));
    const bb = { x0: ins.bbox[0] * k - originM.x, y0: ins.bbox[1] * k - originM.y, x1: ins.bbox[2] * k - originM.x, y1: ins.bbox[3] * k - originM.y };
    let host: Wall | null = null;
    let best = Infinity;
    for (const w of walls) {
      const d = distToSegment(at, w.start, w.end);
      if (d <= w.thicknessM / 2 + 0.15 && d < best) {
        best = d;
        host = w;
      }
    }
    if (!host) {
      issues.push({ code: 'opening-no-host', severity: 'warning', message: `${c === 'door' ? 'Door' : 'Window'} block "${ins.name}" is not on a recognised wall and was skipped.`, sourceHandles: [ins.handle] });
      continue;
    }
    const d = wallDirection(host);
    const corners = [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]].map(([x, y]) => (x! - host.start.x) * d.x + (y! - host.start.y) * d.y);
    const u0 = Math.min(...corners);
    const u1 = Math.max(...corners);
    const defaults = c === 'door' ? opts.door : opts.window;
    const width = q(u1 - u0);
    const notes = ['Height and sill are defaults; they are not stored in the drawing.'];
    let status: Opening['verificationStatus'] = 'detected';
    if (width < 0.4 || width > 3.5) {
      notes.push(`Unusual width ${width.toFixed(2)} m.`);
      status = 'needs-review';
    }
    placed.push({
      sortKey: `${host.id}:${String(Math.round((u0 + u1) * 500)).padStart(8, '0')}`,
      wallId: host.id,
      kind: c === 'door' ? 'door' : 'window',
      offsetM: q((u0 + u1) / 2),
      widthM: width,
      heightM: defaults.heightM,
      sillM: defaults.sillM,
      sourceHandles: [ins.handle],
      verificationStatus: status,
      notes,
    });
  }
  placed.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  placed.forEach((p, i) => {
    const { sortKey: _sortKey, ...rest } = p;
    openings.push({ id: `OPENING-${String(i + 1).padStart(3, '0')}`, ...rest });
  });
  if (openings.length) issues.push({ code: 'opening-defaults', severity: 'info', message: 'Door/window heights and sills use defaults (not present in the drawing). Review them in the plan.', sourceHandles: [] });

  // ---- 8. rooms: explicit room outlines win, otherwise detect from wall topology
  let rooms: Room[] = [];
  if (roomPolys.length) {
    rooms = roomPolys.map((r, i) => {
      const pts = r.pts.map(shift);
      return {
        id: `ROOM-${String(i + 1).padStart(3, '0')}`,
        levelId: LEVEL_ID,
        name: `Room ${i + 1}`,
        polygon: polygonArea(pts) < 0 ? [...pts].reverse() : pts,
        sourceHandles: [r.handle],
        verificationStatus: 'detected',
        notes: [],
      };
    });
  } else if (walls.length) {
    const topo = analyzeTopology(walls);
    rooms = topo.faces.map((f, i) => ({
      id: `ROOM-${String(i + 1).padStart(3, '0')}`,
      levelId: LEVEL_ID,
      name: `Room ${i + 1}`,
      polygon: f.polygon.map((p) => ({ x: q(p.x), y: q(p.y) })),
      sourceHandles: [...new Set(f.wallIds.flatMap((id) => walls.find((w) => w.id === id)?.sourceHandles ?? []))].slice(0, 64),
      verificationStatus: 'detected' as const,
      notes: ['Detected from closed wall loop.'],
    }));
  }

  return {
    parts: { levels: [{ id: LEVEL_ID, name: 'Ground floor', elevationM: 0, heightM: opts.wallHeightM }], walls, openings, rooms },
    originM,
    issues,
    stats: { segments: segs.length, duplicatesRemoved, walls: walls.length, openings: openings.length, rooms: rooms.length, gapsClosed: closeLog.length },
  };
}

const key4 = (c: { start: Pt; end: Pt }) =>
  Math.round(Math.min(c.start.x, c.end.x) * 1000) * 1e7 + Math.round(Math.min(c.start.y, c.end.y) * 1000) + Math.round(Math.max(c.start.x, c.end.x) * 1000) * 1e-3;

function pairDoubleLines(segs: Seg[], minT: number, maxT: number): { walls: Array<{ start: Pt; end: Pt; thicknessM: number; handles: string[]; flags: string[] }>; unpaired: Seg[] } {
  const walls: Array<{ start: Pt; end: Pt; thicknessM: number; handles: string[]; flags: string[] }> = [];
  const used = segs.map(() => [] as Array<[number, number]>);
  const dirs = segs.map((s) => {
    const l = dist(s.a, s.b);
    return { x: (s.b.x - s.a.x) / l, y: (s.b.y - s.a.y) / l, l };
  });
  type Pair = { i: number; j: number; t: number; lo: number; hi: number };
  const pairs: Pair[] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const di = dirs[i]!;
      const dj = dirs[j]!;
      if (Math.abs(di.x * dj.y - di.y * dj.x) > Math.sin(rad(1))) continue;
      const si = segs[i]!;
      const sj = segs[j]!;
      const perp = (p: Pt) => (p.x - si.a.x) * -di.y + (p.y - si.a.y) * di.x;
      const t = Math.abs((perp(sj.a) + perp(sj.b)) / 2);
      if (t < minT || t > maxT || Math.abs(perp(sj.a) - perp(sj.b)) > 0.01) continue;
      const along = (p: Pt) => (p.x - si.a.x) * di.x + (p.y - si.a.y) * di.y;
      const [b0, b1] = [along(sj.a), along(sj.b)].sort((x, y) => x - y) as [number, number];
      const lo = Math.max(0, b0);
      const hi = Math.min(di.l, b1);
      if (hi - lo < 0.1) continue;
      pairs.push({ i, j, t, lo, hi });
    }
  }
  pairs.sort((a, b) => b.hi - b.lo - (a.hi - a.lo) || a.i - b.i || a.j - b.j);
  const free = (u: Array<[number, number]>, lo: number, hi: number) => u.every(([a, b]) => Math.min(hi, b) - Math.max(lo, a) < 0.5 * (hi - lo));
  for (const p of pairs) {
    const si = segs[p.i]!;
    const sj = segs[p.j]!;
    const di = dirs[p.i]!;
    const dj = dirs[p.j]!;
    // interval on j in j's own parameterisation
    const sameDir = di.x * dj.x + di.y * dj.y > 0;
    const ju = (pt: Pt) => (pt.x - sj.a.x) * dj.x + (pt.y - sj.a.y) * dj.y;
    const pi = (u: number): Pt => ({ x: si.a.x + di.x * u, y: si.a.y + di.y * u });
    const jLo = ju(pi(p.lo));
    const jHi = ju(pi(p.hi));
    const jr: [number, number] = [Math.min(jLo, jHi), Math.max(jLo, jHi)];
    void sameDir;
    if (!free(used[p.i]!, p.lo, p.hi) || !free(used[p.j]!, jr[0], jr[1])) continue;
    used[p.i]!.push([p.lo, p.hi]);
    used[p.j]!.push(jr);
    // centreline = midway between the two lines over the overlap
    const a = pi(p.lo);
    const b = pi(p.hi);
    const nrm = { x: -di.y, y: di.x };
    const sign = Math.sign((sj.a.x - si.a.x) * nrm.x + (sj.a.y - si.a.y) * nrm.y) || 1;
    const off = (sign * p.t) / 2;
    walls.push({
      start: { x: a.x + nrm.x * off, y: a.y + nrm.y * off },
      end: { x: b.x + nrm.x * off, y: b.y + nrm.y * off },
      thicknessM: p.t,
      handles: [...si.handles, ...sj.handles],
      flags: si.approximated || sj.approximated ? ['Curved wall approximated by straight segments.'] : [],
    });
  }
  const unpaired = segs.filter((_, i) => used[i]!.length === 0);
  return { walls, unpaired };
}

function mergeCollinear<T extends { start: Pt; end: Pt; thicknessM: number; handles: string[]; flags: string[] }>(list: T[]): T[] {
  const out = list.map((c) => ({ ...c, handles: [...c.handles], flags: [...c.flags] }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        if (Math.abs(a.thicknessM - b.thicknessM) > 1e-6) continue;
        for (const [pa, pb] of [[a.end, b.start], [a.end, b.end], [a.start, b.start], [a.start, b.end]] as const) {
          if (dist(pa, pb) > EPS * 2) continue;
          const da = { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
          const db = { x: b.end.x - b.start.x, y: b.end.y - b.start.y };
          const cross = (da.x * db.y - da.y * db.x) / (Math.hypot(da.x, da.y) * Math.hypot(db.x, db.y));
          if (Math.abs(cross) > 1e-3) continue;
          // third walls touching the joint keep the split (T-junction), so only merge a pure continuation
          const joint = pa;
          const degree = out.filter((o, k) => k !== i && k !== j && (dist(o.start, joint) <= EPS * 2 || dist(o.end, joint) <= EPS * 2)).length;
          if (degree > 0) continue;
          const pts = [a.start, a.end, b.start, b.end];
          let best: [Pt, Pt] = [a.start, a.end];
          let bd = -1;
          for (const p of pts) for (const r of pts) if (dist(p, r) > bd) { bd = dist(p, r); best = [p, r]; }
          a.start = best[0];
          a.end = best[1];
          a.handles.push(...b.handles);
          a.flags.push(...b.flags);
          out.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return out;
}

function closeGaps(
  cands: Array<{ start: Pt; end: Pt; thicknessM: number }>,
  opts: RecognitionOptions,
  log: Array<{ i: number; d: number }>,
) {
  for (let i = 0; i < cands.length; i++) {
    for (const which of ['start', 'end'] as const) {
      const a = cands[i]!;
      const p = a[which];
      const gap = Math.max(opts.closeGapM, opts.wallMode === 'double-line' ? a.thicknessM : 0);
      // already connected?
      if (cands.some((o, j) => j !== i && distToSegment(p, o.start, o.end) <= EPS * 2)) continue;
      let best: { x: Pt; d: number } | null = null;
      for (let j = 0; j < cands.length; j++) {
        if (j === i) continue;
        const o = cands[j]!;
        const x = lineIntersection(a.start, a.end, o.start, o.end);
        if (!x) continue;
        const d = dist(x, p);
        if (d <= gap && distToSegment(x, o.start, o.end) <= gap && (!best || d < best.d)) best = { x, d };
      }
      if (best && best.d > EPS) {
        a[which] = best.x;
        log.push({ i, d: best.d });
      }
    }
  }
}
