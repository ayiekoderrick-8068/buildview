import { describe, expect, it } from 'vitest';
import { buildRectangularWalls, validateWall, wallBoxes, wallDimensions } from '../src/index.ts';

const room = { length: 5, width: 4, height: 2.8, wallThickness: 0.2 };

describe('rectangular walls', () => {
  const walls = buildRectangularWalls(room);

  it('reports interior face lengths matching the room', () => {
    const byId = Object.fromEntries(walls.map((w) => [w.id, wallDimensions(w)]));
    expect(byId['wall-north']?.length).toBeCloseTo(5);
    expect(byId['wall-south']?.length).toBeCloseTo(5);
    expect(byId['wall-east']?.length).toBeCloseTo(4);
    expect(byId['wall-west']?.length).toBeCloseTo(4);
    expect(byId['wall-north']?.height).toBe(2.8);
    expect(byId['wall-north']?.thickness).toBe(0.2);
  });

  it('builds a single solid box for a wall without openings', () => {
    const boxes = wallBoxes(walls[0]!);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.size[0]).toBeCloseTo(5.4); // extended over both corners
    expect(boxes[0]?.size[1]).toBe(2.8);
  });

  it('cuts openings out of the wall and subtracts their area', () => {
    const [north] = buildRectangularWalls(room, {
      north: [{ id: 'w', kind: 'window', offset: 2.5, width: 2, height: 1.5, sill: 0.8 }],
    });
    const boxes = wallBoxes(north!);
    // left, below, above, right
    expect(boxes).toHaveLength(4);
    expect(wallDimensions(north!).netArea).toBeCloseTo(5 * 2.8 - 3);
  });

  it('rejects overlapping or out-of-range openings', () => {
    const [north] = buildRectangularWalls(room, {
      north: [{ id: 'w', kind: 'window', offset: 4.9, width: 1, height: 1, sill: 0 }],
    });
    expect(validateWall(north!)).toMatch(/past the wall end/);
  });
});
