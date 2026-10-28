import { describe, expect, it } from 'vitest';
import { SceneDocumentSchema } from '@buildview/shared';
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
  it('is valid and has the specified room dimensions and four stable walls', () => {
    const doc = createSampleDocument();
    expect(SceneDocumentSchema.safeParse(doc).success).toBe(true);
    expect(doc.room).toEqual({ length: 5, width: 4, height: 2.8, wallThickness: 0.2 });
    expect(doc.walls.map((w) => w.id)).toEqual(['wall-north', 'wall-east', 'wall-south', 'wall-west']);
    expect(createSampleDocument().walls.map((w) => w.id)).toEqual(doc.walls.map((w) => w.id));
  });
});

describe('updateSurfaces', () => {
  it('changes only the selected wall material', () => {
    const doc = createSampleDocument();
    const next = updateSurfaces(doc, ['wall-north'], { color: '#c4553b' });
    expect(next.surfaces['wall-north']?.color).toBe('#C4553B');
    for (const id of ['wall-east', 'wall-south', 'wall-west', 'floor', 'ceiling']) {
      expect(next.surfaces[id]).toBe(doc.surfaces[id]); // same reference: untouched
    }
  });

  it('never modifies geometry (walls, room) when changing materials', () => {
    const doc = createSampleDocument();
    const next = updateSurfaces(doc, ['wall-north', 'wall-south'], { color: '#1F2F54', finish: 'gloss' });
    expect(next.walls).toBe(doc.walls);
    expect(next.room).toBe(doc.room);
    expect(JSON.stringify(next.walls)).toBe(JSON.stringify(doc.walls));
  });

  it('applies to a group and to all walls independently of each other', () => {
    const doc = createSampleDocument();
    const all = updateSurfaces(doc, doc.walls.map((w) => w.id), { color: '#3A3D42' });
    expect(doc.walls.every((w) => all.surfaces[w.id]?.color === '#3A3D42')).toBe(true);
    expect(all.surfaces['floor']).toBe(doc.surfaces['floor']);
    // surfaces are distinct objects, so later edits cannot leak between walls
    expect(all.surfaces['wall-north']).not.toBe(all.surfaces['wall-south']);
  });

  it('returns the same document for no-ops and rejects unknown surfaces', () => {
    const doc = createSampleDocument();
    expect(updateSurfaces(doc, ['wall-north'], { color: doc.surfaces['wall-north']!.color })).toBe(doc);
    expect(() => updateSurfaces(doc, ['wall-missing'], { color: '#000000' })).toThrow();
  });

  it('ignores controls that do not apply to the finish', () => {
    const doc = createSampleDocument();
    const next = updateSurfaces(doc, ['wall-north'], { metalness: 0.9, textureScale: 5 });
    expect(next).toBe(doc); // matte paint has no adjustable metalness or texture
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
    expect(h.present.surfaces['wall-north']?.color).toBe('#C4553B');
    h = undo(h);
    expect(h.present.surfaces['wall-north']?.color).toBe('#87B4D8');
    h = undo(h);
    expect(h.present).toBe(doc);
    h = redo(h);
    expect(h.present.surfaces['wall-north']?.color).toBe('#87B4D8');
  });

  it('clears the redo stack when a new edit is made', () => {
    let h = createHistory(createSampleDocument());
    h = commit(h, updateSurfaces(h.present, ['wall-north'], { color: '#87B4D8' }));
    h = undo(h);
    h = commit(h, updateSurfaces(h.present, ['wall-east'], { color: '#87B4D8' }));
    expect(h.future).toHaveLength(0);
  });

  it('coalesces rapid edits with the same key into a single undo step', () => {
    let h = createHistory(createSampleDocument());
    for (let i = 0; i < 5; i++) {
      h = commit(h, setLighting(h.present, { sun: 1 + (i + 1) / 10 }), { key: 'sun', now: 1000 + i * 10 });
    }
    expect(h.past).toHaveLength(1);
    expect(undo(h).present.lighting.sun).toBe(1);
  });

  it('records a drag as one step and ignores drags that change nothing', () => {
    const base = createSampleDocument();
    let h = createHistory(base);
    h = replacePresent(h, moveFurniture(h.present, 'coffee-table', [0.3, 0.1]));
    h = replacePresent(h, moveFurniture(h.present, 'coffee-table', [0.2, 0.2]));
    h = commitTransient(h, base);
    expect(h.past).toEqual([base]);
    expect(commitTransient(createHistory(base), base).past).toHaveLength(0);
  });
});

describe('furniture operations', () => {
  it('moves furniture and keeps it inside the room', () => {
    const doc = createSampleDocument();
    const moved = moveFurniture(doc, 'coffee-table', [0.2, 0.3]);
    expect(moved.furniture.find((f) => f.id === 'coffee-table')?.position).toEqual([0.2, 0.3]);
    const far = moveFurniture(doc, 'coffee-table', [50, 50]);
    const pos = far.furniture.find((f) => f.id === 'coffee-table')!.position;
    expect(pos[0]).toBeLessThanOrEqual(2.5);
    expect(pos[1]).toBeLessThanOrEqual(2);
  });

  it('prevents solid items from overlapping', () => {
    const doc = createSampleDocument();
    const sofa = doc.furniture.find((f) => f.id === 'sofa-main')!;
    const moved = moveFurniture(doc, 'coffee-table', [sofa.position[0], sofa.position[1]]);
    const table = moved.furniture.find((f) => f.id === 'coffee-table')!;
    expect(table.position).not.toEqual(sofa.position);
  });

  it('rotates, resets, deletes (only optional items) and restores', () => {
    const doc = createSampleDocument();
    const rotated = rotateFurniture(doc, 'coffee-table', Math.PI / 4);
    expect(rotated.furniture.find((f) => f.id === 'coffee-table')?.rotationY).toBeCloseTo(Math.PI / 4);

    const moved = moveFurniture(rotated, 'coffee-table', [0.2, 0.3]);
    const reset = resetFurniture(moved, 'coffee-table');
    expect(reset.furniture.find((f) => f.id === 'coffee-table')?.position).toEqual([0.7, 0]);
    expect(reset.furniture.find((f) => f.id === 'coffee-table')?.rotationY).toBe(0);

    expect(deleteFurniture(doc, 'sofa-main')).toBe(doc); // required item
    const deleted = deleteFurniture(doc, 'plant-main');
    expect(deleted.furniture.find((f) => f.id === 'plant-main')?.deleted).toBe(true);
    const restored = restoreFurniture(deleted, 'plant-main');
    expect(restored.furniture.find((f) => f.id === 'plant-main')?.deleted).toBe(false);
  });

  it('does not move non-movable items and never changes walls', () => {
    const doc = createSampleDocument();
    expect(moveFurniture(doc, 'wall-art-main', [0, 0])).toBe(doc);
    expect(moveFurniture(doc, 'coffee-table', [0.2, 0.3]).walls).toBe(doc.walls);
  });
});
