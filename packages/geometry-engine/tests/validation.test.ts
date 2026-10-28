import { describe, expect, it } from 'vitest';
import type { Opening, SceneDocument, Wall } from '@buildview/shared';
import { createRectangularHouse, hasBlockingIssues, validateDocument, walkStep, buildWalkObstacles } from '../src/index.ts';

const base = (): SceneDocument => ({
  schemaVersion: 2,
  ...createRectangularHouse({ lengthM: 5, widthM: 4, heightM: 2.8, wallThicknessM: 0.2 }),
  roof: null,
  surfaces: {},
  furniture: [],
  lighting: { preset: 'daylight', ambient: 1, sun: 1, interior: true },
  sources: [],
  acknowledgedIssues: [],
  approval: { status: 'draft', approvedAt: null },
});
const codes = (d: SceneDocument) => validateDocument(d).map((i) => i.code);
const opening = (over: Partial<Opening>): Opening => ({ id: 'o1', wallId: 'wall-north', kind: 'door', offsetM: 2.6, widthM: 0.9, heightM: 2.1, sillM: 0, sourceHandles: [], verificationStatus: 'manual', notes: [], ...over });

describe('validateDocument', () => {
  it('a clean rectangular house has no critical or warning issues apart from missing materials', () => {
    const issues = validateDocument(base());
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
  });

  it('flags zero-length walls, duplicates and overlaps as critical', () => {
    const d = base();
    const w = d.walls[0]!;
    const dup: Wall = { ...w, id: 'dup' };
    expect(codes({ ...d, walls: [...d.walls, dup] })).toContain('wall-duplicate');
    const part: Wall = { ...w, id: 'part', start: { x: -1, y: w.start.y }, end: { x: 1, y: w.start.y } };
    expect(codes({ ...d, walls: [...d.walls, part] })).toContain('wall-overlap');
    const zero: Wall = { ...w, id: 'zero', start: { x: 0, y: 0 }, end: { x: 0, y: 0 } };
    expect(codes({ ...d, walls: [...d.walls, zero] })).toContain('wall-zero-length');
  });

  it('flags openings that are too large, outside the wall, too tall, overlapping or orphaned', () => {
    const d = base();
    const check = (ops: Opening[]) => validateDocument({ ...d, openings: ops }).map((i) => i.code);
    expect(check([opening({ widthM: 6 })])).toContain('opening-larger-than-wall');
    expect(check([opening({ offsetM: 5.1 })])).toContain('opening-outside-wall');
    expect(check([opening({ heightM: 3 })])).toContain('opening-taller-than-wall');
    expect(check([opening({ id: 'a' }), opening({ id: 'b', offsetM: 3 })])).toContain('opening-overlap');
    expect(check([opening({ wallId: 'nope' })])).toContain('opening-orphan');
    expect(hasBlockingIssues(validateDocument({ ...d, openings: [opening({ widthM: 6 })] }))).toBe(true);
  });

  it('flags self-intersecting rooms and rooms without walls behind them', () => {
    const d = base();
    const bow = { ...d.rooms[0]!, id: 'bow', polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }] };
    expect(codes({ ...d, rooms: [...d.rooms, bow] })).toContain('room-self-intersecting');
    const floating = { ...d.rooms[0]!, id: 'float', polygon: [{ x: 10, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 12 }, { x: 10, y: 12 }] };
    expect(codes({ ...d, rooms: [...d.rooms, floating] })).toContain('room-edge-unbacked');
  });

  it('reports orphaned material assignments and furniture left outside rooms without deleting them', () => {
    const d = base();
    const withOrphan = { ...d, surfaces: { 'WALL-999': { color: '#FF0000', finish: 'matte' as const, roughness: 1, metalness: 0, textureScale: 1 } } };
    expect(validateDocument(withOrphan).find((i) => i.code === 'orphan-material')?.severity).toBe('info');
    const chair = { id: 'c', kind: 'plant' as const, name: 'Plant', position: [20, 20] as [number, number], rotationY: 0, elevation: 0, size: [0.5, 1, 0.5] as [number, number, number], movable: true, removable: true, deleted: false, home: { position: [20, 20] as [number, number], rotationY: 0 } };
    expect(codes({ ...d, furniture: [chair] })).toContain('furniture-outside-room');
  });

  it('warnings can be acknowledged, critical issues cannot', () => {
    const d = base();
    const w: Wall = { ...d.walls[0]!, id: 'stub', start: { x: 0, y: 2.1 }, end: { x: 0, y: 3 }, verificationStatus: 'manual' };
    const withStub = { ...d, walls: [...d.walls, w] };
    const warn = validateDocument(withStub).find((i) => i.code === 'wall-free-end')!;
    expect(warn.status).toBe('open');
    const acked = validateDocument({ ...withStub, acknowledgedIssues: [warn.key] }).find((i) => i.key === warn.key)!;
    expect(acked.status).toBe('acknowledged');
    const crit = validateDocument({ ...d, openings: [opening({ widthM: 6 })], acknowledgedIssues: ['opening-larger-than-wall:o1,wall-north'] }).find((i) => i.severity === 'critical')!;
    expect(crit.status).toBe('open');
  });

  it('is deterministic and sorted critical first', () => {
    const d = { ...base(), openings: [opening({ widthM: 6 })] };
    expect(validateDocument(d)).toEqual(validateDocument(d));
    expect(validateDocument(d)[0]!.severity).toBe('critical');
  });
});

describe('walking collision', () => {
  const d = { ...base(), openings: [opening({ id: 'door', wallId: 'wall-south', offsetM: 2.6 })] };
  const obstacles = buildWalkObstacles(d.walls, d.openings);
  it('stops at walls and passes through door openings', () => {
    expect(walkStep({ x: 0, y: 0 }, { x: 0, y: 1.7 }, 0.25, obstacles)).toEqual({ x: 0, y: 1.7 }); // 0.3 m from the wall face
    const blocked = walkStep({ x: 0, y: 1.5 }, { x: 0, y: 2.1 }, 0.25, obstacles);
    expect(blocked.y).toBeLessThan(2.0);
    // south wall (plan y = -2.1) has a 0.9 m door centred at x = +/- from wall start; door spans the centre of the wall
    const through = walkStep({ x: 0, y: -1.5 }, { x: 0, y: -2.6 }, 0.25, buildWalkObstacles(d.walls, [opening({ id: 'x', wallId: 'wall-south', offsetM: 2.6 })]));
    expect(through.y).toBeLessThan(-2.5);
  });
});
