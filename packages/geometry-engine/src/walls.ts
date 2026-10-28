import type { Opening, Room, Vec2, Wall } from '@buildview/shared';

/** An axis-aligned (in wall-local space) box ready to become a mesh. */
export interface WallBox {
  id: string;
  center: [number, number, number];
  size: [number, number, number];
  /** Rotation about Y so the box's local X axis follows the wall direction. */
  rotationY: number;
}

export function wallLength(wall: Pick<Wall, 'start' | 'end'>): number {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
}

/** Unit vector from start to end. */
export function wallDirection(wall: Pick<Wall, 'start' | 'end'>): Vec2 {
  const len = wallLength(wall);
  return [(wall.end[0] - wall.start[0]) / len, (wall.end[1] - wall.start[1]) / len];
}

export interface WallDimensions {
  /** Length of the room-facing face (what a person measures inside the room). */
  length: number;
  height: number;
  thickness: number;
  /** Face area minus openings, in m^2. */
  netArea: number;
}

export function wallDimensions(wall: Wall): WallDimensions {
  const length = wallLength(wall);
  const openingArea = wall.openings.reduce((sum, o) => sum + o.width * o.height, 0);
  return {
    length,
    height: wall.height,
    thickness: wall.thickness,
    netArea: length * wall.height - openingArea,
  };
}

/** Returns an error message if the wall's openings are not representable, otherwise null. */
export function validateWall(wall: Wall): string | null {
  const len = wallLength(wall);
  if (len <= 0) return `Wall ${wall.id} has zero length`;
  const sorted = [...wall.openings].sort((a, b) => a.offset - b.offset);
  let cursor = 0;
  for (const o of sorted) {
    const from = o.offset - o.width / 2;
    const to = o.offset + o.width / 2;
    if (from < cursor - 1e-9) return `Opening ${o.id} overlaps another opening or the wall start`;
    if (to > len + 1e-9) return `Opening ${o.id} extends past the wall end`;
    if (o.sill + o.height > wall.height + 1e-9) return `Opening ${o.id} is taller than the wall`;
    cursor = to;
  }
  return null;
}

/**
 * Decomposes a wall into solid boxes around its openings. Pure geometry: no appearance.
 * Local frame: u runs start -> end along the interior face, n points outward.
 */
export function wallBoxes(wall: Wall): WallBox[] {
  const error = validateWall(wall);
  if (error) throw new Error(error);

  const len = wallLength(wall);
  const [ux, uz] = wallDirection(wall);
  const [nx, nz] = wall.normal;
  const rotationY = Math.atan2(-uz, ux);
  const t = wall.thickness;

  const boxes: WallBox[] = [];
  const add = (suffix: string, u0: number, u1: number, y0: number, y1: number) => {
    if (u1 - u0 < 1e-6 || y1 - y0 < 1e-6) return;
    const uc = (u0 + u1) / 2;
    boxes.push({
      id: `${wall.id}:${suffix}`,
      center: [
        wall.start[0] + ux * uc + nx * (t / 2),
        (y0 + y1) / 2,
        wall.start[1] + uz * uc + nz * (t / 2),
      ],
      size: [u1 - u0, y1 - y0, t],
      rotationY,
    });
  };

  const sorted = [...wall.openings].sort((a, b) => a.offset - b.offset);
  let cursor = -wall.extendStart;
  sorted.forEach((o, i) => {
    const from = o.offset - o.width / 2;
    const to = o.offset + o.width / 2;
    add(`solid-${i}`, cursor, from, 0, wall.height);
    add(`below-${o.id}`, from, to, 0, o.sill);
    add(`above-${o.id}`, from, to, o.sill + o.height, wall.height);
    cursor = to;
  });
  add(`solid-${sorted.length}`, cursor, len + wall.extendEnd, 0, wall.height);
  return boxes;
}

/** World-space centre of an opening on the wall's interior plane, plus its in-wall depth axis. */
export function openingPlacement(wall: Wall, opening: Opening) {
  const [ux, uz] = wallDirection(wall);
  const [nx, nz] = wall.normal;
  return {
    center: [
      wall.start[0] + ux * opening.offset + nx * (wall.thickness / 2),
      opening.sill + opening.height / 2,
      wall.start[1] + uz * opening.offset + nz * (wall.thickness / 2),
    ] as [number, number, number],
    rotationY: Math.atan2(-uz, ux),
  };
}

export interface RoomOpenings {
  north?: Opening[];
  east?: Opening[];
  south?: Opening[];
  west?: Opening[];
}

/**
 * Builds the four walls of a rectangular room. Interior spans x in [-L/2, L/2], z in [-W/2, W/2].
 * North/south walls extend by the wall thickness at both ends to close the corners.
 */
export function buildRectangularWalls(room: Room, openings: RoomOpenings = {}): Wall[] {
  const hl = room.length / 2;
  const hw = room.width / 2;
  const t = room.wallThickness;
  const base = { height: room.height, thickness: t };
  return [
    {
      ...base,
      id: 'wall-north',
      name: 'North wall',
      start: [-hl, -hw],
      end: [hl, -hw],
      normal: [0, -1],
      extendStart: t,
      extendEnd: t,
      openings: openings.north ?? [],
    },
    {
      ...base,
      id: 'wall-east',
      name: 'East wall',
      start: [hl, -hw],
      end: [hl, hw],
      normal: [1, 0],
      extendStart: 0,
      extendEnd: 0,
      openings: openings.east ?? [],
    },
    {
      ...base,
      id: 'wall-south',
      name: 'South wall',
      start: [hl, hw],
      end: [-hl, hw],
      normal: [0, 1],
      extendStart: t,
      extendEnd: t,
      openings: openings.south ?? [],
    },
    {
      ...base,
      id: 'wall-west',
      name: 'West wall',
      start: [-hl, hw],
      end: [-hl, -hw],
      normal: [-1, 0],
      extendStart: 0,
      extendEnd: 0,
      openings: openings.west ?? [],
    },
  ];
}
