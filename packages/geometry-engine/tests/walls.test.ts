import { describe, expect, it } from 'vitest';
import type { Opening } from '@buildview/shared';
import { createRectangularHouse, validateWallOpenings, wallBoxes, wallDimensions, wallExtensions } from '../src/index.ts';

const spec = { lengthM: 5, widthM: 4, heightM: 2.8, wallThicknessM: 0.2 };
const house = createRectangularHouse(spec);

describe('rectangular house', () => {
  it('has centreline walls that enclose the requested interior', () => {
    const north = house.walls.find((w) => w.id === 'wall-north')!;
    const east = house.walls.find((w) => w.id === 'wall-east')!;
    expect(wallDimensions(north, []).lengthM).toBeCloseTo(5.2); // centreline: interior + one thickness
    expect(wallDimensions(east, []).lengthM).toBeCloseTo(4.2);
    expect(house.rooms[0]!.polygon).toHaveLength(4);
  });

  it('extends corner walls by half the joining wall thickness so corners are filled', () => {
    const ext = wallExtensions(house.walls);
    for (const w of house.walls) {
      expect(ext.get(w.id)).toEqual({ start: 0.1, end: 0.1 });
    }
  });

  it('maps plan (x, y) to world (x, h, -y)', () => {
    const north = house.walls.find((w) => w.id === 'wall-north')!;
    const [box] = wallBoxes(north, [], { start: 0, end: 0 });
    expect(box!.center[0]).toBeCloseTo(0);
    expect(box!.center[2]).toBeCloseTo(-2.1); // plan y = +2.1 (north) -> world z = -2.1
    expect(box!.center[1]).toBeCloseTo(1.4);
    expect(box!.size).toEqual([5.2, 2.8, 0.2]);
  });
});

describe('openings', () => {
  const north = house.walls.find((w) => w.id === 'wall-north')!;
  const win: Opening = { id: 'w1', wallId: north.id, kind: 'window', offsetM: 2.6, widthM: 2, heightM: 1.5, sillM: 0.8, sourceHandles: [], verificationStatus: 'manual', notes: [] };

  it('cuts real openings: solid left, below, above, solid right', () => {
    const boxes = wallBoxes(north, [win]);
    expect(boxes).toHaveLength(4);
    const below = boxes.find((b) => b.id.includes('below'))!;
    const above = boxes.find((b) => b.id.includes('above'))!;
    expect(below.size).toEqual([2, 0.8, 0.2]);
    expect(above.size[1]).toBeCloseTo(2.8 - 0.8 - 1.5);
    expect(wallDimensions(north, [win]).netAreaM2).toBeCloseTo(5.2 * 2.8 - 3);
  });

  it('door openings reach the floor and have no "below" box', () => {
    const door: Opening = { ...win, id: 'd1', kind: 'door', widthM: 0.9, heightM: 2.1, sillM: 0 };
    const boxes = wallBoxes(north, [door]);
    expect(boxes.some((b) => b.id.includes('below'))).toBe(false);
    expect(boxes).toHaveLength(3);
  });

  it('detects unrepresentable openings and never throws while rendering', () => {
    const bad = { ...win, offsetM: 5.15 };
    expect(validateWallOpenings(north, [bad])).toMatch(/past the wall end/);
    expect(() => wallBoxes(north, [bad])).not.toThrow();
    expect(validateWallOpenings(north, [{ ...win, sillM: 2 }])).toMatch(/taller/);
    expect(validateWallOpenings(north, [win, { ...win, id: 'w2', offsetM: 3 }])).toMatch(/overlaps/);
  });
});
