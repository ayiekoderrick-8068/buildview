import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSampleDocument } from '@buildview/design-engine';
import type { Project, SaveProjectRequest } from '@buildview/shared';

const saveMock = vi.fn<(id: string, body: SaveProjectRequest) => Promise<Project>>();
vi.mock('../src/api/client.ts', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, readonly status: number, readonly code?: string) {
      super(message);
    }
  },
  api: {
    save: (id: string, body: SaveProjectRequest) => saveMock(id, body),
    health: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    createSample: vi.fn(),
    duplicate: vi.fn(),
  },
}));

const { useEditor } = await import('../src/state/editorStore.ts');

function load(storage: 'postgres' | 'offline' = 'postgres') {
  const document = createSampleDocument();
  const project: Project = { id: 'p1', name: 'Test', revision: 1, updatedAt: new Date().toISOString(), document, editorMeta: {} };
  useEditor.getState().loadProject(project, storage);
  return project;
}
const doc = () => useEditor.getState().history.present;
const color = (id: string) => doc().surfaces[id]?.color;

beforeEach(() => {
  saveMock.mockReset();
  load();
});

describe('selection', () => {
  it('selects a wall, adds with shift, and deselects', () => {
    const s = useEditor.getState();
    s.selectWall('wall-north');
    expect(useEditor.getState().selection).toEqual({ kind: 'wall', ids: ['wall-north'] });
    s.selectWall('wall-east', true);
    expect(useEditor.getState().selection?.ids).toEqual(['wall-north', 'wall-east']);
    s.selectWall('wall-north', true); // toggles off
    expect(useEditor.getState().selection?.ids).toEqual(['wall-east']);
    s.selectFurniture('sofa-main');
    expect(useEditor.getState().selection).toEqual({ kind: 'furniture', ids: ['sofa-main'] });
    s.clearSelection();
    expect(useEditor.getState().selection).toBeNull();
  });

  it('drops a selection that no longer exists after undo', () => {
    const s = useEditor.getState();
    s.removeFurniture('plant-main');
    s.selectFurniture('plant-main');
    s.undo(); // restores the plant, still valid
    expect(useEditor.getState().selection?.ids).toEqual(['plant-main']);
    s.redo(); // plant deleted again -> selection must be cleared
    expect(useEditor.getState().selection).toBeNull();
  });
});

describe('painting', () => {
  it('changes only the targeted wall and never its dimensions', () => {
    const before = doc();
    useEditor.getState().paint(['wall-north'], { color: '#C4553B' });
    const after = doc();
    expect(color('wall-north')).toBe('#C4553B');
    expect(color('wall-east')).toBe(before.surfaces['wall-east']?.color);
    expect(color('wall-south')).toBe(before.surfaces['wall-south']?.color);
    expect(color('wall-west')).toBe(before.surfaces['wall-west']?.color);
    expect(after.walls).toBe(before.walls);
    expect(after.openings).toBe(before.openings);
    expect(after.rooms).toBe(before.rooms);
    expect(after.levels[0]?.heightM).toBe(2.8);
  });

  it('marks the project dirty, and clean again after undo', () => {
    const s = useEditor.getState();
    expect(useEditor.getState().dirty).toBe(false);
    s.paint(['wall-north'], { color: '#87B4D8' });
    expect(useEditor.getState().dirty).toBe(true);
    s.undo();
    expect(useEditor.getState().dirty).toBe(false);
    s.redo();
    expect(useEditor.getState().dirty).toBe(true);
  });

  it('supports undo/redo across several edits', () => {
    const s = useEditor.getState();
    const original = color('wall-north');
    s.paint(['wall-north'], { color: '#87B4D8' });
    s.paint(['wall-north'], { color: '#C4553B' });
    s.undo();
    expect(color('wall-north')).toBe('#87B4D8');
    s.undo();
    expect(color('wall-north')).toBe(original);
    s.redo();
    s.redo();
    expect(color('wall-north')).toBe('#C4553B');
  });
});

describe('furniture', () => {
  it('records a whole drag as a single undo step', () => {
    const s = useEditor.getState();
    const start = doc().furniture.find((f) => f.id === 'coffee-table')!.position;
    s.beginDrag();
    s.dragFurnitureTo('coffee-table', [0.2, 0.4]);
    s.dragFurnitureTo('coffee-table', [0.1, 0.5]);
    s.endDrag();
    expect(doc().furniture.find((f) => f.id === 'coffee-table')?.position).toEqual([0.1, 0.5]);
    expect(useEditor.getState().history.past).toHaveLength(1);
    s.undo();
    expect(doc().furniture.find((f) => f.id === 'coffee-table')?.position).toEqual(start);
  });

  it('rotates, resets, removes and restores', () => {
    const s = useEditor.getState();
    s.rotateFurnitureBy('coffee-table', Math.PI / 2);
    expect(doc().furniture.find((f) => f.id === 'coffee-table')?.rotationY).toBeCloseTo(Math.PI / 2);
    s.resetFurnitureTransform('coffee-table');
    expect(doc().furniture.find((f) => f.id === 'coffee-table')?.rotationY).toBe(0);
    s.removeFurniture('sofa-main'); // required item: ignored
    expect(doc().furniture.find((f) => f.id === 'sofa-main')?.deleted).toBe(false);
    s.removeFurniture('rug-main');
    expect(doc().furniture.find((f) => f.id === 'rug-main')?.deleted).toBe(true);
    s.restoreRemovedFurniture('rug-main');
    expect(doc().furniture.find((f) => f.id === 'rug-main')?.deleted).toBe(false);
  });
});

describe('save and reload', () => {
  it('only reports saved after the server confirms, and round-trips exactly', async () => {
    const s = useEditor.getState();
    s.paint(['wall-north'], { color: '#C4553B' });
    const edited = doc();

    let release!: (p: Project) => void;
    saveMock.mockImplementation(() => new Promise<Project>((resolve) => (release = resolve)));
    const pending = s.saveProject();
    expect(useEditor.getState().save.status).toBe('saving');
    expect(useEditor.getState().dirty).toBe(true); // not saved until confirmed

    release({ id: 'p1', name: 'Test', revision: 2, updatedAt: new Date().toISOString(), document: edited, editorMeta: {} });
    await pending;
    expect(useEditor.getState().dirty).toBe(false);
    expect(useEditor.getState().project?.revision).toBe(2);
    expect(saveMock.mock.calls[0]?.[1].baseRevision).toBe(1);
    expect(saveMock.mock.calls[0]?.[1].document).toEqual(edited);

    // Reload what the server returned and compare with the editor state.
    useEditor.getState().loadProject({ id: 'p1', name: 'Test', revision: 2, updatedAt: '', document: structuredClone(edited), editorMeta: {} }, 'postgres');
    expect(doc()).toEqual(edited);
    expect(useEditor.getState().dirty).toBe(false);
  });

  it('keeps the project dirty and surfaces an error when saving fails', async () => {
    const s = useEditor.getState();
    s.paint(['wall-north'], { color: '#C4553B' });
    saveMock.mockRejectedValue(new Error('boom'));
    expect(await s.saveProject()).toBe(false);
    expect(useEditor.getState().save).toMatchObject({ status: 'error', error: 'boom' });
    expect(useEditor.getState().dirty).toBe(true);
  });

  it('keeps edits made while a save is in flight dirty', async () => {
    const s = useEditor.getState();
    s.paint(['wall-north'], { color: '#C4553B' });
    const saved = doc();
    saveMock.mockImplementation(async () => {
      useEditor.getState().paint(['wall-east'], { color: '#1F2F54' }); // edit during the request
      return { id: 'p1', name: 'Test', revision: 2, updatedAt: '', document: saved, editorMeta: {} };
    });
    await s.saveProject();
    expect(useEditor.getState().dirty).toBe(true);
  });

  it('refuses to save in offline mode without calling the API', async () => {
    load('offline');
    useEditor.setState({ project: null });
    useEditor.getState().paint(['wall-north'], { color: '#C4553B' });
    expect(await useEditor.getState().saveProject()).toBe(false);
    expect(saveMock).not.toHaveBeenCalled();
    expect(useEditor.getState().save.status).toBe('error');
  });
});
