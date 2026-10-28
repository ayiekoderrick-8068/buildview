import type { Level, Opening, Pt, Room, SceneDocument, Wall } from '@buildview/shared';

/** Geometric tolerance (metres) used for "same point" decisions. 0.1 mm. */
export const EPS = 1e-4;
/** Stored lengths are quantised to 0.01 mm; never coarser, so nothing is silently rounded away. */
export const q = (n: number): number => Math.round(n * 1e5) / 1e5;

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** A solid box (in wall-local space) ready to become a mesh. World mapping: (x, y, z) = (planX, height, -planY). */
export interface WallBox {
  id: string;
  center: [number, number, number];
  size: [number, number, number];
  rotationY: number;
}

export const wallLength = (w: Pick<Wall, 'start' | 'end'>) => dist(w.start, w.end);

export function wallDirection(w: Pick<Wall, 'start' | 'end'>): Pt {
  const len = wallLength(w);
  return len < 1e-12 ? { x: 1, y: 0 } : { x: (w.end.x - w.start.x) / len, y: (w.end.y - w.start.y) / len };
}

/** Rotation about world Y for a plan direction. */
export const planRotationY = (d: Pt) => Math.atan2(d.y, d.x);

export interface WallDimensions {
  lengthM: number;
  heightM: number;
  thicknessM: number;
  /** Centreline length times height minus openings. */
  netAreaM2: number;
}

export function wallDimensions(wall: Wall, openings: readonly Opening[]): WallDimensions {
  const lengthM = wallLength(wall);
  const cut = openings.filter((o) => o.wallId === wall.id).reduce((s, o) => s + o.widthM * o.heightM, 0);
  return { lengthM, heightM: wall.heightM, thicknessM: wall.thicknessM, netAreaM2: lengthM * wall.heightM - cut };
}

export interface WallExtension {
  start: number;
  end: number;
}

/**
 * Corner joins: where exactly two walls meet end-to-end at an angle, each wall is extended by the
 * other's half-thickness (divided by sin of the angle, capped) so the outside corner is filled.
 * Free ends, collinear continuations and T/X nodes (>2 walls) are left untouched. This is a simple
 * butt-join: exact for 90° corners, approximate for other angles (documented limitation).
 */
export function wallExtensions(walls: readonly Wall[], tol = EPS * 5): Map<string, WallExtension> {
  const out = new Map<string, WallExtension>();
  for (const w of walls) out.set(w.id, { start: 0, end: 0 });
  const ends = walls.flatMap((w) => [
    { w, which: 'start' as const, p: w.start },
    { w, which: 'end' as const, p: w.end },
  ]);
  for (const e of ends) {
    const others = ends.filter((o) => o.w.id !== e.w.id && dist(o.p, e.p) <= tol);
    if (others.length !== 1) continue;
    const o = others[0]!;
    // Does a third wall pass through this node (T/X)? then no extension.
    const through = walls.some(
      (x) => x.id !== e.w.id && x.id !== o.w.id && distToSegment(e.p, x.start, x.end) <= tol,
    );
    if (through) continue;
    const da = e.which === 'start' ? neg(wallDirection(e.w)) : wallDirection(e.w);
    const db = o.which === 'start' ? neg(wallDirection(o.w)) : wallDirection(o.w);
    const cos = da.x * db.x + da.y * db.y; // both pointing away from the shared node's walls
    const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    if (sin < 0.05) continue; // collinear or doubling back
    const ext = Math.min(o.w.thicknessM / 2 / sin, o.w.thicknessM * 2);
    const rec = out.get(e.w.id)!;
    rec[e.which] = ext;
  }
  return out;
}

const neg = (p: Pt): Pt => ({ x: -p.x, y: -p.y });

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Returns an error message if the wall's openings are not representable, otherwise null. */
export function validateWallOpenings(wall: Wall, openings: readonly Opening[]): string | null {
  const len = wallLength(wall);
  if (len <= EPS) return `Wall ${wall.id} has zero length`;
  const mine = openings.filter((o) => o.wallId === wall.id).sort((a, b) => a.offsetM - b.offsetM);
  let cursor = 0;
  for (const o of mine) {
    const from = o.offsetM - o.widthM / 2;
    const to = o.offsetM + o.widthM / 2;
    if (from < -EPS) return `Opening ${o.id} starts before the wall start`;
    if (to > len + EPS) return `Opening ${o.id} extends past the wall end`;
    if (from < cursor - EPS) return `Opening ${o.id} overlaps another opening`;
    if (o.sillM + o.heightM > wall.heightM + EPS) return `Opening ${o.id} is taller than the wall`;
    cursor = to;
  }
  return null;
}

/**
 * Decomposes a wall into solid boxes around its openings. Pure geometry: no appearance.
 * Invalid openings are skipped (validation reports them) so a bad edit never crashes rendering.
 */
export function wallBoxes(wall: Wall, openings: readonly Opening[], ext: WallExtension = { start: 0, end: 0 }): WallBox[] {
  const len = wallLength(wall);
  if (len <= EPS) return [];
  const d = wallDirection(wall);
  const rotationY = planRotationY(d);
  const t = wall.thicknessM;
  const mine = openings
    .filter((o) => o.wallId === wall.id)
    .sort((a, b) => a.offsetM - b.offsetM)
    .filter((o) => o.offsetM - o.widthM / 2 >= -EPS && o.offsetM + o.widthM / 2 <= len + EPS && o.sillM + o.heightM <= wall.heightM + EPS);

  const boxes: WallBox[] = [];
  const add = (suffix: string, u0: number, u1: number, y0: number, y1: number) => {
    if (u1 - u0 < 1e-6 || y1 - y0 < 1e-6) return;
    const uc = (u0 + u1) / 2;
    boxes.push({
      id: `${wall.id}:${suffix}`,
      center: [wall.start.x + d.x * uc, (y0 + y1) / 2, -(wall.start.y + d.y * uc)],
      size: [u1 - u0, y1 - y0, t],
      rotationY,
    });
  };
  let cursor = -ext.start;
  mine.forEach((o, i) => {
    const from = o.offsetM - o.widthM / 2;
    const to = o.offsetM + o.widthM / 2;
    add(`solid-${i}`, cursor, from, 0, wall.heightM);
    add(`below-${o.id}`, from, to, 0, o.sillM);
    add(`above-${o.id}`, from, to, o.sillM + o.heightM, wall.heightM);
    cursor = to;
  });
  add(`solid-${mine.length}`, cursor, len + ext.end, 0, wall.heightM);
  return boxes;
}

/** World-space centre of an opening and the rotation of its host wall. */
export function openingPlacement(wall: Wall, o: Opening) {
  const d = wallDirection(wall);
  return {
    center: [wall.start.x + d.x * o.offsetM, o.sillM + o.heightM / 2, -(wall.start.y + d.y * o.offsetM)] as [number, number, number],
    rotationY: planRotationY(d),
  };
}

export const planToWorld = (p: Pt, h = 0): [number, number, number] => [p.x, h, -p.y];

// ---------------------------------------------------------------- building helpers

export interface RectRoomSpec {
  lengthM: number;
  widthM: number;
  heightM: number;
  wallThicknessM: number;
}

export interface RectOpeningSpec {
  north?: Array<Omit<Opening, 'wallId' | 'sourceHandles' | 'verificationStatus' | 'notes'>>;
  east?: Array<Omit<Opening, 'wallId' | 'sourceHandles' | 'verificationStatus' | 'notes'>>;
  south?: Array<Omit<Opening, 'wallId' | 'sourceHandles' | 'verificationStatus' | 'notes'>>;
  west?: Array<Omit<Opening, 'wallId' | 'sourceHandles' | 'verificationStatus' | 'notes'>>;
}

export const LEVEL_ID = 'LEVEL-001';

/** One rectangular room: interior is lengthM x widthM centred on the origin; walls are centred outside it. */
export function createRectangularHouse(
  spec: RectRoomSpec,
  openings: RectOpeningSpec = {},
): Pick<SceneDocument, 'levels' | 'walls' | 'openings' | 'rooms'> {
  const t = spec.wallThicknessM;
  const hx = spec.lengthM / 2 + t / 2;
  const hy = spec.widthM / 2 + t / 2;
  const level: Level = { id: LEVEL_ID, name: 'Ground floor', elevationM: 0, heightM: spec.heightM };
  const mk = (id: string, name: string, start: Pt, end: Pt): Wall => ({
    id,
    levelId: LEVEL_ID,
    name,
    start,
    end,
    thicknessM: t,
    heightM: spec.heightM,
    sourceHandles: [],
    verificationStatus: 'manual',
    notes: [],
  });
  const walls = [
    mk('wall-north', 'North wall', { x: -hx, y: hy }, { x: hx, y: hy }),
    mk('wall-east', 'East wall', { x: hx, y: hy }, { x: hx, y: -hy }),
    mk('wall-south', 'South wall', { x: hx, y: -hy }, { x: -hx, y: -hy }),
    mk('wall-west', 'West wall', { x: -hx, y: -hy }, { x: -hx, y: hy }),
  ];
  const ops: Opening[] = [];
  for (const [side, list] of Object.entries(openings) as Array<[keyof RectOpeningSpec, NonNullable<RectOpeningSpec['north']>]>) {
    for (const o of list) {
      ops.push({ ...o, wallId: `wall-${side}`, sourceHandles: [], verificationStatus: 'manual', notes: [] });
    }
  }
  const room: Room = {
    id: 'room-living',
    levelId: LEVEL_ID,
    name: 'Living room',
    polygon: [
      { x: -spec.lengthM / 2, y: -spec.widthM / 2 },
      { x: spec.lengthM / 2, y: -spec.widthM / 2 },
      { x: spec.lengthM / 2, y: spec.widthM / 2 },
      { x: -spec.lengthM / 2, y: spec.widthM / 2 },
    ],
    sourceHandles: [],
    verificationStatus: 'manual',
    notes: [],
  };
  return { levels: [level], walls, openings: ops, rooms: [room] };
}
