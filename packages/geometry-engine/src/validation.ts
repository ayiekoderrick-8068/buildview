import type { SceneDocument, ValidationIssue } from '@buildview/shared';
import { floorSurfaceId, ceilingSurfaceId, ROOF_SURFACE_ID } from '@buildview/shared';
import { footprintInsideRooms } from './placement.ts';
import { isSelfIntersecting, polygonArea } from './polygon.ts';
import { analyzeTopology } from './topology.ts';
import { dist, distToSegment, EPS, validateWallOpenings, wallLength } from './walls.ts';

export interface ValidationOptions {
  /** Distance under which two points are "the same" (metres). */
  tolM?: number;
  /** Largest endpoint-to-wall distance still reported as a closable gap (metres). */
  gapM?: number;
}

type Draft = Omit<ValidationIssue, 'key' | 'status'>;

/**
 * Deterministic model validation. Pure: same document and options always give the same issues,
 * ordered critical -> warning -> info. Critical issues block approval / 3D generation.
 */
export function validateDocument(doc: SceneDocument, opts: ValidationOptions = {}): ValidationIssue[] {
  const tol = opts.tolM ?? EPS * 5;
  const gapM = opts.gapM ?? 0.5;
  const drafts: Draft[] = [];
  const add = (code: string, severity: Draft['severity'], elementIds: string[], message: string, suggestion?: string, handles: string[] = []) =>
    drafts.push({ code, severity, elementIds, message, ...(suggestion ? { suggestion } : {}), sourceHandles: handles });

  const handlesOf = (id: string) => {
    const w = doc.walls.find((x) => x.id === id) ?? doc.openings.find((x) => x.id === id) ?? doc.rooms.find((x) => x.id === id);
    return w?.sourceHandles ?? [];
  };
  const levelIds = new Set(doc.levels.map((l) => l.id));
  const wallsById = new Map(doc.walls.map((w) => [w.id, w]));

  if (doc.levels.length > 1) {
    add('unsupported-levels', 'warning', doc.levels.map((l) => l.id), 'Multiple levels are stored but only single-storey buildings are generated in this version.', 'Keep one level, or treat extra levels as planned functionality.');
  }

  // ---- walls
  for (const w of doc.walls) {
    if (!levelIds.has(w.levelId)) add('wall-unknown-level', 'critical', [w.id], `${w.name} references missing level ${w.levelId}.`, 'Assign the wall to an existing level.', w.sourceHandles);
    const len = wallLength(w);
    if (len <= tol) add('wall-zero-length', 'critical', [w.id], `${w.name} has zero length.`, 'Delete the wall or drag its endpoint away from the other end.', w.sourceHandles);
    if (w.thicknessM <= 0 || w.heightM <= 0) add('wall-nonpositive-size', 'critical', [w.id], `${w.name} has a zero or negative thickness/height.`, 'Set a positive thickness and height.', w.sourceHandles);
    const err = validateWallOpenings(w, doc.openings);
    if (err && len > tol) add('wall-opening-conflict', 'critical', [w.id], err + '.', 'Move or resize the opening so it fits inside the wall.', w.sourceHandles);
  }

  // duplicates and overlaps (collinear segments sharing length)
  for (let i = 0; i < doc.walls.length; i++) {
    for (let j = i + 1; j < doc.walls.length; j++) {
      const a = doc.walls[i]!;
      const b = doc.walls[j]!;
      const same = (dist(a.start, b.start) <= tol && dist(a.end, b.end) <= tol) || (dist(a.start, b.end) <= tol && dist(a.end, b.start) <= tol);
      if (same) {
        add('wall-duplicate', 'critical', [a.id, b.id], `${a.name} and ${b.name} are duplicates (same endpoints).`, 'Delete one of the two walls.', [...a.sourceHandles, ...b.sourceHandles]);
        continue;
      }
      if (collinearOverlap(a, b, tol) > Math.max(tol, 0.01)) {
        add('wall-overlap', 'critical', [a.id, b.id], `${a.name} overlaps ${b.name} along part of their length.`, 'Trim one wall so they only meet end-to-end.', [...a.sourceHandles, ...b.sourceHandles]);
      }
    }
  }

  // ---- topology: gaps, free ends, crossings
  const topo = analyzeTopology(doc.walls, tol);
  const gapPairs = new Set<string>();
  for (const d of topo.danglingEnds) {
    const w = wallsById.get(d.wallId)!;
    let nearest: { id: string; d: number } | null = null;
    for (const o of doc.walls) {
      if (o.id === w.id) continue;
      const dd = distToSegment(d.point, o.start, o.end);
      if (!nearest || dd < nearest.d) nearest = { id: o.id, d: dd };
    }
    if (nearest && nearest.d > tol && nearest.d <= gapM) {
      // Two loose ends facing each other describe ONE gap; report it once.
      const pair = [w.id, nearest.id].sort().join('|');
      if (gapPairs.has(pair)) continue;
      gapPairs.add(pair);
      add('wall-gap', 'critical', [w.id, nearest.id], `${w.name} (${d.which}) stops ${(nearest.d * 1000).toFixed(0)} mm short of ${wallsById.get(nearest.id)!.name}; the room boundary is open.`, 'Drag the endpoint onto the other wall so they connect.', [...w.sourceHandles, ...handlesOf(nearest.id)]);
    } else {
      add('wall-free-end', 'warning', [w.id], `${w.name} (${d.which}) is not connected to any other wall.`, 'Connect it to another wall, or leave it if it is a free-standing partition.', w.sourceHandles);
    }
  }
  for (const c of topo.crossings) {
    add('wall-crossing', 'warning', [c.a, c.b], `${wallsById.get(c.a)!.name} crosses ${wallsById.get(c.b)!.name} without an end-point joint.`, 'Split the walls at the crossing if this is intentional.', [...handlesOf(c.a), ...handlesOf(c.b)]);
  }
  if (doc.walls.length >= 3 && topo.faces.length === 0 && doc.rooms.length === 0) {
    add('no-closed-rooms', 'warning', [], 'The walls do not enclose any closed room.', 'Close the gaps between walls or draw room boundaries manually.');
  }

  // ---- openings
  for (const o of doc.openings) {
    const w = wallsById.get(o.wallId);
    if (!w) {
      add('opening-orphan', 'critical', [o.id], `Opening ${o.id} references missing wall ${o.wallId}.`, 'Delete the opening or re-add it to a wall.', o.sourceHandles);
      continue;
    }
    const len = wallLength(w);
    if (o.widthM > len + tol) add('opening-larger-than-wall', 'critical', [o.id, w.id], `${o.id} (${o.widthM.toFixed(2)} m) is wider than ${w.name} (${len.toFixed(2)} m).`, 'Reduce the opening width.', o.sourceHandles);
    else if (o.offsetM - o.widthM / 2 < -tol || o.offsetM + o.widthM / 2 > len + tol) add('opening-outside-wall', 'critical', [o.id, w.id], `${o.id} extends beyond the ends of ${w.name}.`, 'Move the opening along the wall until it fits.', o.sourceHandles);
    if (o.sillM + o.heightM > w.heightM + tol) add('opening-taller-than-wall', 'critical', [o.id, w.id], `${o.id} (sill ${o.sillM.toFixed(2)} + height ${o.heightM.toFixed(2)} m) is taller than ${w.name} (${w.heightM.toFixed(2)} m).`, 'Lower the sill or reduce the height.', o.sourceHandles);
  }
  for (const w of doc.walls) {
    const list = doc.openings.filter((o) => o.wallId === w.id).sort((a, b) => a.offsetM - b.offsetM);
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i]!;
      const b = list[i + 1]!;
      if (a.offsetM + a.widthM / 2 > b.offsetM - b.widthM / 2 + tol) add('opening-overlap', 'critical', [a.id, b.id], `${a.id} and ${b.id} overlap on ${w.name}.`, 'Move one of the openings.', [...a.sourceHandles, ...b.sourceHandles]);
    }
  }

  // ---- rooms
  for (const r of doc.rooms) {
    if (!levelIds.has(r.levelId)) add('room-unknown-level', 'critical', [r.id], `${r.name} references missing level ${r.levelId}.`);
    if (isSelfIntersecting(r.polygon)) add('room-self-intersecting', 'critical', [r.id], `${r.name} has a self-intersecting boundary.`, 'Redraw the room boundary.', r.sourceHandles);
    else if (Math.abs(polygonArea(r.polygon)) <= tol) add('room-zero-area', 'critical', [r.id], `${r.name} has zero area.`, 'Delete or redraw the room.', r.sourceHandles);
    const unbacked = roomUnbackedEdges(doc, r);
    if (unbacked > 0) add('room-edge-unbacked', 'warning', [r.id], `${unbacked} edge(s) of ${r.name} have no wall behind them, so the room boundary has a gap.`, 'Draw walls along the open edges or adjust the room boundary.', r.sourceHandles);
  }

  // ---- furniture and materials
  for (const f of doc.furniture) {
    if (f.deleted) continue;
    if (!footprintInsideRooms({ position: f.position, rotationY: f.rotationY, size: f.size }, doc.rooms, 0.02)) {
      add('furniture-outside-room', 'warning', [f.id], `${f.name} is no longer inside a room (the plan changed).`, 'Move it back inside a room or remove it.');
    }
  }
  const elementIds = new Set<string>([
    ...doc.walls.map((w) => w.id),
    ...doc.rooms.flatMap((r) => [floorSurfaceId(r.id), ceilingSurfaceId(r.id)]),
    ROOF_SURFACE_ID,
  ]);
  const orphans = Object.keys(doc.surfaces).filter((id) => !elementIds.has(id));
  for (const id of orphans) {
    add('orphan-material', 'info', [id], `Material assignment "${id}" no longer belongs to any element. It is kept in case the element is restored.`, 'Undo the deletion, or ignore this note.');
  }

  // ---- review status
  const needs = [...doc.walls, ...doc.openings, ...doc.rooms].filter((e) => e.verificationStatus === 'needs-review');
  for (const e of needs) {
    add('needs-review', 'warning', [e.id], `${e.id} was flagged during import and needs review${e.notes[0] ? `: ${e.notes[0]}` : '.'}`, 'Check it in the plan, then mark it as reviewed.', e.sourceHandles);
  }
  const unreviewed = [...doc.walls, ...doc.openings, ...doc.rooms].filter((e) => e.verificationStatus === 'detected');
  if (unreviewed.length > 0) {
    add('unreviewed-elements', 'info', unreviewed.map((e) => e.id), `${unreviewed.length} detected element(s) have not been reviewed yet.`, 'Inspect the plan against the source drawing and mark elements as reviewed.');
  }
  for (const s of doc.sources) for (const note of s.issues) {
    drafts.push({ code: `import-${note.code}`, severity: note.severity, elementIds: [s.sourceId], message: note.message, sourceHandles: note.sourceHandles });
  }

  const ack = new Set(doc.acknowledgedIssues);
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return drafts
    .map((d): ValidationIssue => {
      const key = `${d.code}:${[...d.elementIds].sort().join(',')}`;
      return { ...d, key, status: d.severity !== 'critical' && ack.has(key) ? 'acknowledged' : 'open' };
    })
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.key.localeCompare(b.key));
}

export const hasBlockingIssues = (issues: readonly ValidationIssue[]) =>
  issues.some((i) => i.severity === 'critical' && i.status === 'open');

function collinearOverlap(a: SceneDocument['walls'][number], b: SceneDocument['walls'][number], tol: number): number {
  const la = wallLength(a);
  if (la <= tol) return 0;
  const dx = (a.end.x - a.start.x) / la;
  const dy = (a.end.y - a.start.y) / la;
  const off = (p: { x: number; y: number }) => Math.abs((p.x - a.start.x) * dy - (p.y - a.start.y) * dx);
  if (off(b.start) > tol || off(b.end) > tol) return 0;
  const proj = (p: { x: number; y: number }) => (p.x - a.start.x) * dx + (p.y - a.start.y) * dy;
  const [b0, b1] = [proj(b.start), proj(b.end)].sort((x, y) => x - y) as [number, number];
  return Math.max(0, Math.min(la, b1) - Math.max(0, b0));
}

function roomUnbackedEdges(doc: SceneDocument, room: SceneDocument['rooms'][number]): number {
  if (doc.walls.length === 0) return 0;
  let bad = 0;
  const n = room.polygon.length;
  for (let i = 0; i < n; i++) {
    const a = room.polygon[i]!;
    const b = room.polygon[(i + 1) % n]!;
    const samples = [0.25, 0.5, 0.75].map((t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
    const backed = samples.every((p) => doc.walls.some((w) => distToSegment(p, w.start, w.end) <= w.thicknessM / 2 + 0.06));
    if (!backed) bad++;
  }
  return bad;
}
