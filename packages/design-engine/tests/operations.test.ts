import { describe, expect, it } from 'vitest';
import { SceneDocumentSchema } from '@buildview/shared';
import { validateDocument } from '@buildview/geometry-engine';
import {
  commit,
  commitTransient,
  createHistory,
  createSampleDocument,
  deleteFurniture,
  moveFurniture,
  redo,
  replacePresent,
  resetFurniture,
  restoreFurniture,
  rotateFurniture,
  setLighting,
  undo,
  updateSurfaces,
} from '../src/index.ts';

describe('sample document', () => {
  it('is valid, has stable wall ids, 5 x 4 x 2.8 m interior and passes model validation', () => {
    const doc = createSampleDocument();
    expect(SceneDocumentSchema.safeParse(doc).success).toBe(true);
    expect(doc.walls.map((w) => w.id)).toEqual(['wall-north', 'wall-east', 'wall-south', 'wall-west']);
    const poly = doc.rooms[0]!.polygon;
    expect(Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x))).toBeCloseTo(5);
    expect(Math.max(...poly.map((p) => p.y)) - Math.min(...poly.map((p) => p.y))).toBeCloseTo(4);
    expect(doc.levels[0]!.heightM).toBe(2.8);
    expect(validateDocument(doc).filter((i) => i.severity !== 'info')).toEqual([]);
    expect(createSampleDocument().walls.map((w) => w.id)).toEqual(doc.walls.map((w) => w.id));
  });
});

describe('updateSurfaces', () => {
  it('changes only the selected wall material', () => {
    const doc = createSampleDocument();
    const next = updateSurfaces(doc, ['wall-north'], { color: '#c4553b' });
    expect(next.surfaces['wall-north']?.color).toBe('#C4553B');
    for (const id of ['wall-east', 'wall-south', 'wall-west', 'room-living:floor', 'room-living:ceiling']) {
      expect(next.surfaces[id]).toBe(doc.surfaces[id]);
    }
  });

  it('never modifies geometry when changing materials', () => {
    const doc = createSampleDocument();
    const next = updateSurfaces(doc, ['wall-north', 'wall-south'], { color: '#1F2F54', finish: 'gloss' });
    expect(next.walls).toBe(doc.walls);
    expect(next.openings).toBe(doc.openings);
    expect(next.rooms).toBe(doc.rooms);
    expect(JSON.stringify(next.walls)).toBe(JSON.stringify(doc.walls));
  });

  it('applies to a group and to all walls independently of each other', () => {
    const doc = createSampleDocument();
    const all = updateSurfaces(doc, doc.walls.map((w) => w.id), { color: '#3A3D42' });
    expect(doc.walls.every((w) => all.surfaces[w.id]?.color === '#3A3D42')).toBe(true);
    expect(all.surfaces['room-living:floor']).toBe(doc.surfaces['room-living:floor']);
    expect(all.surfaces['wall-north']).not.toBe(all.surfaces['wall-south']);
  });

  it('can restyle floors and ceilings and rejects unknown surfaces', () => {
    const doc = createSampleDocument();
    expect(updateSurfaces(doc, ['room-living:floor'], { color: '#CCBBAA' }).surfaces['room-living:floor']?.color).toBe('#CCBBAA');
    expect(() => updateSurfaces(doc, ['wall-missing'], { color: '#000000' })).toThrow();
    expect(updateSurfaces(doc, ['wall-north'], { color: doc.surfaces['wall-north']!.color })).toBe(doc);
  });

  it('ignores controls that do not apply to the finish', () => {
    const doc = createSampleDocument();
    expect(updateSurfaces(doc, ['wall-north'], { metalness: 0.9, textureScale: 5 })).toBe(doc);
    const metallic = updateSurfaces(doc, ['wall-north'], { finish: 'metallic' });
    expect(updateSurfaces(metallic, ['wall-north'], { metalness: 0.9 }).surfaces['wall-north']?.metalness).toBe(0.9);
    const plaster = updateSurfaces(doc, ['wall-north'], { finish: 'plaster' });
    expect(updateSurfaces(plaster, ['wall-north'], { textureScale: 3 }).surfaces['wall-north']?.textureScale).toBe(3);
  });
});

describe('history', () => {
  it('supports undo and redo of material edits', () => {
    const doc = createSampleDocument();
    let h = createHistory(doc);
    h = commit(h, updateSurfaces(h.present, ['wall-north'], { color: '#87B4D8' }));
    h = commit(h, updateSurfaces(h.present, ['wall-north'], { color: '#C4553B' }));
    h = undo(h);
    expect(h.present.surfaces['wall-north']?.color).toBe('#87B4D8');
    h = undo(h);
    expect(h.present).toBe(doc);
    h = redo(h);
    expect(h.present.surfaces['wall-north']?.color).toBe('#87B4D8');
  });

  it('coalesces rapid edits with the same key and records a drag as one step', () => {
    let h = createHistory(createSampleDocument());
    for (let i = 0; i < 5; i++) h = commit(h, setLighting(h.present, { sun: 1 + (i + 1) / 10 }), { key: 'sun', now: 1000 + i * 10 });
    expect(h.past).toHaveLength(1);
    const base = createSampleDocument();
    let d = createHistory(base);
    d = replacePresent(d, moveFurniture(d.present, 'coffee-table', [0.3, 0.1]));
    d = replacePresent(d, moveFurniture(d.present, 'coffee-table', [0.2, 0.2]));
    expect(commitTransient(d, base).past).toEqual([base]);
    expect(commitTransient(createHistory(base), base).past).toHaveLength(0);
  });
});

describe('furniture operations', () => {
  const pos = (doc: ReturnType<typeof createSampleDocument>, id: string) => doc.furniture.find((f) => f.id === id)!.position;

  it('moves furniture and keeps it inside the room polygon', () => {
    const doc = createSampleDocument();
    expect(pos(moveFurniture(doc, 'coffee-table', [0.2, 0.3]), 'coffee-table')).toEqual([0.2, 0.3]);
    const far = pos(moveFurniture(doc, 'coffee-table', [50, 50]), 'coffee-table');
    expect(Math.abs(far[0])).toBeLessThanOrEqual(2.5);
    expect(Math.abs(far[1])).toBeLessThanOrEqual(2);
  });

  it('prevents solid items from overlapping', () => {
    const doc = createSampleDocument();
    const sofa = pos(doc, 'sofa-main');
    expect(pos(moveFurniture(doc, 'coffee-table', [sofa[0], sofa[1]]), 'coffee-table')).not.toEqual(sofa);
  });

  it('rotates, resets, deletes only optional items and restores', () => {
    const doc = createSampleDocument();
    expect(rotateFurniture(doc, 'coffee-table', Math.PI / 4).furniture.find((f) => f.id === 'coffee-table')?.rotationY).toBeCloseTo(Math.PI / 4);
    const reset = resetFurniture(moveFurniture(rotateFurniture(doc, 'coffee-table', Math.PI / 4), 'coffee-table', [0.2, 0.3]), 'coffee-table');
    expect(pos(reset, 'coffee-table')).toEqual([0.7, 0]);
    expect(deleteFurniture(doc, 'sofa-main')).toBe(doc);
    const deleted = deleteFurniture(doc, 'plant-main');
    expect(deleted.furniture.find((f) => f.id === 'plant-main')?.deleted).toBe(true);
    expect(restoreFurniture(deleted, 'plant-main').furniture.find((f) => f.id === 'plant-main')?.deleted).toBe(false);
  });

  it('does not move wall-mounted items and never changes walls', () => {
    const doc = createSampleDocument();
    expect(moveFurniture(doc, 'wall-art-main', [0, 0])).toBe(doc);
    expect(moveFurniture(doc, 'coffee-table', [0.2, 0.3]).walls).toBe(doc.walls);
  });
});
