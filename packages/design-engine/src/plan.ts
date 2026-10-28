import {
  analyzeTopology,
  distToSegment,
  dist,
  EPS,
  hasBlockingIssues,
  pointInPolygon,
  q,
  validateDocument,
  wallDirection,
  wallLength,
  type ValidationOptions,
} from '@buildview/geometry-engine';
import type { Opening, Pt, Room, SceneDocument, VerificationStatus, Wall } from '@buildview/shared';
import { ensureSurfaces } from './sample.ts';

/**
 * Pure plan-editing operations on the canonical building model. Every one returns the SAME document
 * reference when nothing changed. Coordinates are quantised to 0.01 mm (never coarser).
 */

const CONNECT_TOL = EPS * 5;
const pt = (p: Pt): Pt => ({ x: q(p.x), y: q(p.y) });

export function nextId(prefix: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  for (let i = 1; ; i++) {
    const id = `${prefix}-${String(i).padStart(3, '0')}`;
    if (!used.has(id)) return id;
  }
}

const mapWall = (doc: SceneDocument, id: string, f: (w: Wall) => Wall): SceneDocument => {
  const walls = doc.walls.map((w) => (w.id === id ? f(w) : w));
  return { ...doc, walls };
};
const touched = (w: Wall): Wall => (w.verificationStatus === 'manual' ? w : { ...w, verificationStatus: 'reviewed' });

export function addWall(
  doc: SceneDocument,
  start: Pt,
  end: Pt,
  opts: { thicknessM?: number; heightM?: number } = {},
): { doc: SceneDocument; id: string | null } {
  const s = pt(start);
  const e = pt(end);
  if (dist(s, e) <= EPS) return { doc, id: null };
  const level = doc.levels[0]!;
  const id = nextId('WALL', doc.walls.map((w) => w.id));
  const wall: Wall = {
    id,
    levelId: level.id,
    name: `Wall ${doc.walls.length + 1}`,
    start: s,
    end: e,
    thicknessM: opts.thicknessM ?? doc.walls[doc.walls.length - 1]?.thicknessM ?? 0.2,
    heightM: opts.heightM ?? level.heightM,
    sourceHandles: [],
    verificationStatus: 'manual',
    notes: [],
  };
  return { doc: ensureSurfaces({ ...doc, walls: [...doc.walls, wall] }), id };
}

/** Moves one endpoint. Endpoints of other walls that were joined to it follow (keeps the plan connected). */
export function moveWallPoint(doc: SceneDocument, wallId: string, which: 'start' | 'end', to: Pt, dragConnected = true): SceneDocument {
  const wall = doc.walls.find((w) => w.id === wallId);
  if (!wall) throw new Error(`Unknown wall: ${wallId}`);
  const target = pt(to);
  const from = wall[which];
  if (dist(from, target) <= 1e-9) return doc;
  const walls = doc.walls.map((w) => {
    if (w.id === wallId) return touched({ ...w, [which]: target });
    if (!dragConnected) return w;
    let next = w;
    for (const end of ['start', 'end'] as const) {
      if (dist(w[end], from) <= CONNECT_TOL) next = touched({ ...next, [end]: target });
    }
    return next;
  });
  return { ...doc, walls };
}

export function translateWall(doc: SceneDocument, wallId: string, dx: number, dy: number): SceneDocument {
  const wall = doc.walls.find((w) => w.id === wallId);
  if (!wall) throw new Error(`Unknown wall: ${wallId}`);
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return doc;
  const move = (p: Pt): Pt => pt({ x: p.x + dx, y: p.y + dy });
  const oldS = wall.start;
  const oldE = wall.end;
  const walls = doc.walls.map((w) => {
    if (w.id === wallId) return touched({ ...w, start: move(w.start), end: move(w.end) });
    let next = w;
    for (const end of ['start', 'end'] as const) {
      if (dist(w[end], oldS) <= CONNECT_TOL || dist(w[end], oldE) <= CONNECT_TOL) next = touched({ ...next, [end]: move(w[end]) });
    }
    return next;
  });
  return { ...doc, walls };
}

/** Sets the wall length by moving its END point along its current direction (start stays fixed). */
export function setWallLength(doc: SceneDocument, wallId: string, lengthM: number): SceneDocument {
  const wall = doc.walls.find((w) => w.id === wallId);
  if (!wall || !(lengthM > EPS)) return doc;
  const d = wallDirection(wall);
  return moveWallPoint(doc, wallId, 'end', { x: wall.start.x + d.x * lengthM, y: wall.start.y + d.y * lengthM });
}

export function setWallThickness(doc: SceneDocument, wallId: string, thicknessM: number): SceneDocument {
  if (!(thicknessM > 0) || !doc.walls.some((w) => w.id === wallId && w.thicknessM !== q(thicknessM))) return doc;
  return mapWall(doc, wallId, (w) => touched({ ...w, thicknessM: q(thicknessM) }));
}

export function setWallHeight(doc: SceneDocument, wallId: string, heightM: number): SceneDocument {
  if (!(heightM > 0) || !doc.walls.some((w) => w.id === wallId && w.heightM !== q(heightM))) return doc;
  return mapWall(doc, wallId, (w) => touched({ ...w, heightM: q(heightM) }));
}

/** Deletes the wall and its openings. Its material assignment is kept (reported as an orphan, restorable by undo). */
export function deleteWall(doc: SceneDocument, wallId: string): SceneDocument {
  if (!doc.walls.some((w) => w.id === wallId)) return doc;
  return { ...doc, walls: doc.walls.filter((w) => w.id !== wallId), openings: doc.openings.filter((o) => o.wallId !== wallId) };
}

export const OPENING_DEFAULTS: Record<Opening['kind'], { widthM: number; heightM: number; sillM: number }> = {
  door: { widthM: 0.9, heightM: 2.1, sillM: 0 },
  doorway: { widthM: 0.9, heightM: 2.1, sillM: 0 },
  window: { widthM: 1.2, heightM: 1.2, sillM: 0.9 },
  'glazed-door': { widthM: 1.8, heightM: 2.1, sillM: 0 },
};

export function nearestWall(doc: SceneDocument, p: Pt, maxDistM = 0.4): { wall: Wall; offsetM: number; distM: number } | null {
  let best: { wall: Wall; offsetM: number; distM: number } | null = null;
  for (const w of doc.walls) {
    const d = distToSegment(p, w.start, w.end);
    if (d > Math.max(maxDistM, w.thicknessM / 2 + 0.05)) continue;
    if (!best || d < best.distM) {
      const dir = wallDirection(w);
      best = { wall: w, offsetM: (p.x - w.start.x) * dir.x + (p.y - w.start.y) * dir.y, distM: d };
    }
  }
  return best;
}

/** Free interval [lo, hi] along the wall around `offsetM` where an opening of `width` can sit. */
function clampOffset(doc: SceneDocument, wall: Wall, openingId: string | null, offsetM: number, widthM: number): number | null {
  const len = wallLength(wall);
  const others = doc.openings.filter((o) => o.wallId === wall.id && o.id !== openingId).sort((a, b) => a.offsetM - b.offsetM);
  let lo = widthM / 2;
  let hi = len - widthM / 2;
  for (const o of others) {
    if (o.offsetM < offsetM) lo = Math.max(lo, o.offsetM + o.widthM / 2 + widthM / 2);
    else hi = Math.min(hi, o.offsetM - o.widthM / 2 - widthM / 2);
  }
  if (lo > hi + 1e-9) return null;
  return q(Math.min(hi, Math.max(lo, offsetM)));
}

export function addOpening(
  doc: SceneDocument,
  kind: Opening['kind'],
  at: Pt,
  size: Partial<Pick<Opening, 'widthM' | 'heightM' | 'sillM'>> = {},
): { doc: SceneDocument; id: string | null } {
  const host = nearestWall(doc, at);
  if (!host) return { doc, id: null };
  const d = { ...OPENING_DEFAULTS[kind], ...size };
  const heightM = Math.min(d.heightM, host.wall.heightM - d.sillM);
  const offsetM = clampOffset(doc, host.wall, null, host.offsetM, d.widthM);
  if (offsetM === null || heightM <= 0) return { doc, id: null };
  const id = nextId('OPENING', doc.openings.map((o) => o.id));
  const opening: Opening = { id, wallId: host.wall.id, kind, offsetM, widthM: q(d.widthM), heightM: q(heightM), sillM: q(d.sillM), sourceHandles: [], verificationStatus: 'manual', notes: [] };
  return { doc: { ...doc, openings: [...doc.openings, opening] }, id };
}

/** Slides an opening along its host wall, stopping at the wall ends and at neighbouring openings. */
export function moveOpening(doc: SceneDocument, openingId: string, offsetM: number): SceneDocument {
  const o = doc.openings.find((x) => x.id === openingId);
  const wall = o && doc.walls.find((w) => w.id === o.wallId);
  if (!o || !wall) return doc;
  const next = clampOffset(doc, wall, o.id, offsetM, o.widthM);
  if (next === null || next === o.offsetM) return doc;
  return { ...doc, openings: doc.openings.map((x) => (x.id === o.id ? { ...x, offsetM: next, verificationStatus: x.verificationStatus === 'manual' ? 'manual' : ('reviewed' as VerificationStatus) } : x)) };
}

export function updateOpening(doc: SceneDocument, openingId: string, patch: Partial<Pick<Opening, 'widthM' | 'heightM' | 'sillM' | 'kind'>>): SceneDocument {
  const o = doc.openings.find((x) => x.id === openingId);
  if (!o) return doc;
  const next = { ...o, ...patch };
  if (patch.widthM !== undefined) next.widthM = q(patch.widthM);
  if (patch.heightM !== undefined) next.heightM = q(patch.heightM);
  if (patch.sillM !== undefined) next.sillM = q(patch.sillM);
  if (!(next.widthM > 0) || !(next.heightM > 0) || next.sillM < 0) return doc;
  const wall = doc.walls.find((w) => w.id === o.wallId);
  if (wall && patch.widthM !== undefined) {
    const off = clampOffset(doc, wall, o.id, o.offsetM, next.widthM);
    if (off !== null) next.offsetM = off;
  }
  if (next.widthM === o.widthM && next.heightM === o.heightM && next.sillM === o.sillM && next.kind === o.kind && next.offsetM === o.offsetM) return doc;
  next.verificationStatus = o.verificationStatus === 'manual' ? 'manual' : 'reviewed';
  return { ...doc, openings: doc.openings.map((x) => (x.id === o.id ? next : x)) };
}

export function deleteOpening(doc: SceneDocument, openingId: string): SceneDocument {
  if (!doc.openings.some((o) => o.id === openingId)) return doc;
  return { ...doc, openings: doc.openings.filter((o) => o.id !== openingId) };
}

export function addRoom(doc: SceneDocument, polygon: Pt[], name?: string): { doc: SceneDocument; id: string | null } {
  if (polygon.length < 3) return { doc, id: null };
  const pts = polygon.map(pt);
  let area = 0;
  pts.forEach((p, i) => {
    const n = pts[(i + 1) % pts.length]!;
    area += p.x * n.y - n.x * p.y;
  });
  if (Math.abs(area) < 1e-6) return { doc, id: null };
  const id = nextId('ROOM', doc.rooms.map((r) => r.id));
  const room: Room = { id, levelId: doc.levels[0]!.id, name: name ?? `Room ${doc.rooms.length + 1}`, polygon: area < 0 ? pts.reverse() : pts, sourceHandles: [], verificationStatus: 'manual', notes: [] };
  return { doc: ensureSurfaces({ ...doc, rooms: [...doc.rooms, room] }), id };
}

export function deleteRoom(doc: SceneDocument, roomId: string): SceneDocument {
  if (!doc.rooms.some((r) => r.id === roomId)) return doc;
  return { ...doc, rooms: doc.rooms.filter((r) => r.id !== roomId) };
}

/** Adds rooms for closed wall loops that no existing room already covers. */
export function detectMissingRooms(doc: SceneDocument): SceneDocument {
  const topo = analyzeTopology(doc.walls);
  let out = doc;
  for (const f of topo.faces) {
    const centre = f.polygon.reduce((a, p) => ({ x: a.x + p.x / f.polygon.length, y: a.y + p.y / f.polygon.length }), { x: 0, y: 0 });
    const probe = f.polygon.find((p) => pointInPolygon({ x: (p.x + centre.x) / 2, y: (p.y + centre.y) / 2 }, f.polygon)) ? { x: centre.x, y: centre.y } : centre;
    if (out.rooms.some((r) => pointInPolygon(probe, r.polygon))) continue;
    const added = addRoom(out, f.polygon);
    out = added.doc;
  }
  return out;
}

export function markReviewed(doc: SceneDocument, ids: readonly string[]): SceneDocument {
  const set = new Set(ids);
  const upd = <T extends { id: string; verificationStatus: VerificationStatus }>(list: T[]): T[] =>
    list.map((e) => (set.has(e.id) && (e.verificationStatus === 'detected' || e.verificationStatus === 'needs-review') ? { ...e, verificationStatus: 'reviewed' as const } : e));
  const walls = upd(doc.walls);
  const openings = upd(doc.openings);
  const rooms = upd(doc.rooms);
  if (walls.every((w, i) => w === doc.walls[i]) && openings.every((o, i) => o === doc.openings[i]) && rooms.every((r, i) => r === doc.rooms[i])) return doc;
  return { ...doc, walls, openings, rooms };
}

export function acknowledgeIssue(doc: SceneDocument, key: string, on = true): SceneDocument {
  const has = doc.acknowledgedIssues.includes(key);
  if (on === has) return doc;
  return { ...doc, acknowledgedIssues: on ? [...doc.acknowledgedIssues, key] : doc.acknowledgedIssues.filter((k) => k !== key) };
}

export function setRoof(doc: SceneDocument, roof: SceneDocument['roof']): SceneDocument {
  if (JSON.stringify(roof) === JSON.stringify(doc.roof)) return doc;
  return ensureSurfaces({ ...doc, roof });
}

/** Marks the model approved for 3D generation, refused (null) while critical issues are open. */
export function approveModel(doc: SceneDocument, now: string, opts?: ValidationOptions): SceneDocument | null {
  if (hasBlockingIssues(validateDocument(doc, opts))) return null;
  return { ...doc, approval: { status: 'approved', approvedAt: now } };
}

/** Any geometric edit invalidates a previous approval. */
export function revokeApprovalIfEdited(before: SceneDocument, after: SceneDocument): SceneDocument {
  if (after.approval.status !== 'approved') return after;
  const changed = before.walls !== after.walls || before.openings !== after.openings || before.rooms !== after.rooms || before.roof !== after.roof;
  return changed ? { ...after, approval: { status: 'draft', approvedAt: null } } : after;
}
