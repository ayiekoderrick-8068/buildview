import { create } from 'zustand';
import {
  canRedo,
  canUndo,
  commit,
  commitTransient,
  createHistory,
  createSampleDocument,
  deleteFurniture,
  moveFurniture,
  normalizeAngle,
  redo as redoHistory,
  replacePresent,
  resetFurniture,
  restoreFurniture,
  rotateFurniture,
  setLighting,
  undo as undoHistory,
  updateSurfaces,
  type History,
  type SurfacePatch,
} from '@buildview/design-engine';
import type { Lighting, Project, SceneDocument, Vec2 } from '@buildview/shared';
import { api, ApiError } from '../api/client.ts';

export type ViewMode = '3d' | '2d';
export type QualityLevel = 'high' | 'balanced' | 'low';
export type StorageMode = 'postgres' | 'memory' | 'offline';
export type Selection = { kind: 'wall' | 'furniture'; ids: string[] } | null;
export type SaveStatus = 'idle' | 'saving' | 'error';
export type CameraCommand = { type: 'reset' | 'fit'; nonce: number };

export interface EditorState {
  loadState: 'loading' | 'ready' | 'error';
  loadError: string | null;
  storage: StorageMode | null;
  project: { id: string; name: string; revision: number } | null;

  history: History<SceneDocument>;
  /** Document as confirmed by the server (or the initially loaded document). */
  savedDoc: SceneDocument | null;
  dirty: boolean;
  save: { status: SaveStatus; error: string | null; lastSavedAt: number | null };

  selection: Selection;
  viewMode: ViewMode;
  quality: QualityLevel;
  cameraCommand: CameraCommand | null;
  /** True while a furniture drag is in progress (disables orbit controls). */
  dragging: boolean;
  dragBase: SceneDocument | null;

  // lifecycle
  initialize: () => Promise<void>;
  loadProject: (project: Project, storage: StorageMode) => void;
  loadLocalSample: (reason: string) => void;
  // selection
  selectWall: (id: string, additive?: boolean) => void;
  selectFurniture: (id: string) => void;
  clearSelection: () => void;
  // editing
  paint: (surfaceIds: string[], patch: SurfacePatch, coalesceKey?: string) => void;
  beginDrag: () => void;
  dragFurnitureTo: (id: string, position: Vec2) => void;
  endDrag: () => void;
  rotateFurnitureBy: (id: string, deltaRad: number) => void;
  setFurnitureRotation: (id: string, rotationY: number) => void;
  resetFurnitureTransform: (id: string) => void;
  removeFurniture: (id: string) => void;
  restoreRemovedFurniture: (id: string) => void;
  updateLighting: (patch: Partial<Lighting>) => void;
  undo: () => void;
  redo: () => void;
  // view
  setViewMode: (mode: ViewMode) => void;
  setQuality: (q: QualityLevel) => void;
  issueCameraCommand: (type: CameraCommand['type']) => void;
  // persistence
  saveProject: () => Promise<boolean>;
  duplicateProject: () => Promise<void>;
}

const LAST_PROJECT_KEY = 'buildview:lastProject';

function safeStorage<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export const selectDoc = (s: EditorState): SceneDocument => s.history.present;

/** Structural equality is checked only on commit/undo/redo, never per drag frame. */
function isDirty(doc: SceneDocument, saved: SceneDocument | null): boolean {
  if (!saved) return false;
  return doc !== saved && JSON.stringify(doc) !== JSON.stringify(saved);
}

function validSelection(sel: Selection, doc: SceneDocument): Selection {
  if (!sel) return sel;
  const ids = sel.ids.filter((id) =>
    sel.kind === 'wall'
      ? doc.walls.some((w) => w.id === id)
      : doc.furniture.some((f) => f.id === id && !f.deleted),
  );
  return ids.length ? { kind: sel.kind, ids } : null;
}

function initialDoc(): SceneDocument {
  return createSampleDocument();
}

export const useEditor = create<EditorState>()((set, get) => {
  /** Apply a history transition and recompute derived state. */
  const apply = (history: History<SceneDocument>, extra: Partial<EditorState> = {}) => {
    const { savedDoc, selection } = get();
    set({
      history,
      dirty: isDirty(history.present, savedDoc),
      selection: validSelection(selection, history.present),
      ...extra,
    });
  };

  const commitDoc = (next: SceneDocument, key?: string) => {
    const h = get().history;
    if (next === h.present) return;
    apply(commit(h, next, key ? { key } : {}));
  };

  return {
    loadState: 'loading',
    loadError: null,
    storage: null,
    project: null,
    history: createHistory(initialDoc()),
    savedDoc: null,
    dirty: false,
    save: { status: 'idle', error: null, lastSavedAt: null },
    selection: null,
    viewMode: '3d',
    quality: 'balanced',
    cameraCommand: null,
    dragging: false,
    dragBase: null,

    async initialize() {
      set({ loadState: 'loading', loadError: null });
      try {
        const health = await api.health();
        const params = new URLSearchParams(window.location.search);
        const wanted = params.get('project') ?? safeStorage(() => localStorage.getItem(LAST_PROJECT_KEY));
        let project: Project | null = null;
        if (wanted) {
          try {
            project = await api.get(wanted);
          } catch (e) {
            if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 400)) throw e;
          }
        }
        if (!project) {
          const [latest] = await api.list();
          project = latest ? await api.get(latest.id) : await api.createSample();
        }
        get().loadProject(project, health.storage);
      } catch (e) {
        // API unreachable: still allow exploring the sample, but be explicit that nothing can be saved.
        get().loadLocalSample(e instanceof Error ? e.message : 'API unavailable');
      }
    },

    loadProject(project, storage) {
      safeStorage(() => localStorage.setItem(LAST_PROJECT_KEY, project.id));
      const url = new URL(window.location.href);
      if (url.searchParams.get('project') !== project.id) {
        url.searchParams.set('project', project.id);
        window.history.replaceState(null, '', url);
      }
      set({
        loadState: 'ready',
        loadError: null,
        storage,
        project: { id: project.id, name: project.name, revision: project.revision },
        history: createHistory(project.document),
        savedDoc: project.document,
        dirty: false,
        selection: null,
        save: { status: 'idle', error: null, lastSavedAt: null },
      });
    },

    loadLocalSample(reason) {
      const doc = createSampleDocument();
      set({
        loadState: 'ready',
        loadError: reason,
        storage: 'offline',
        project: null,
        history: createHistory(doc),
        savedDoc: doc,
        dirty: false,
        selection: null,
      });
    },

    selectWall(id, additive = false) {
      const { selection } = get();
      if (additive && selection?.kind === 'wall') {
        const ids = selection.ids.includes(id)
          ? selection.ids.filter((x) => x !== id)
          : [...selection.ids, id];
        set({ selection: ids.length ? { kind: 'wall', ids } : null });
      } else {
        set({ selection: { kind: 'wall', ids: [id] } });
      }
    },
    selectFurniture(id) {
      set({ selection: { kind: 'furniture', ids: [id] } });
    },
    clearSelection() {
      if (get().selection) set({ selection: null });
    },

    paint(surfaceIds, patch, coalesceKey) {
      commitDoc(updateSurfaces(get().history.present, surfaceIds, patch), coalesceKey);
    },

    beginDrag() {
      set({ dragging: true, dragBase: get().history.present });
    },
    dragFurnitureTo(id, position) {
      const h = get().history;
      const next = moveFurniture(h.present, id, position);
      if (next === h.present) return;
      // Live updates are not recorded; the whole drag becomes one undo step in endDrag().
      set({ history: replacePresent(h, next), dirty: true });
    },
    endDrag() {
      const { history, dragBase, savedDoc } = get();
      if (!dragBase) return set({ dragging: false });
      const next = commitTransient(history, dragBase);
      set({
        history: next,
        dragging: false,
        dragBase: null,
        dirty: isDirty(next.present, savedDoc),
      });
    },

    rotateFurnitureBy(id, deltaRad) {
      const item = get().history.present.furniture.find((f) => f.id === id);
      if (!item) return;
      commitDoc(rotateFurniture(get().history.present, id, item.rotationY + deltaRad));
    },
    setFurnitureRotation(id, rotationY) {
      commitDoc(rotateFurniture(get().history.present, id, normalizeAngle(rotationY)), `rotate:${id}`);
    },
    resetFurnitureTransform(id) {
      commitDoc(resetFurniture(get().history.present, id));
    },
    removeFurniture(id) {
      commitDoc(deleteFurniture(get().history.present, id));
    },
    restoreRemovedFurniture(id) {
      commitDoc(restoreFurniture(get().history.present, id));
    },
    updateLighting(patch) {
      const key = 'ambient' in patch ? 'light:ambient' : 'sun' in patch ? 'light:sun' : undefined;
      commitDoc(setLighting(get().history.present, patch), key);
    },

    undo() {
      if (get().dragging) return;
      apply(undoHistory(get().history));
    },
    redo() {
      if (get().dragging) return;
      apply(redoHistory(get().history));
    },

    setViewMode(mode) {
      set({ viewMode: mode, cameraCommand: { type: 'reset', nonce: Date.now() } });
    },
    setQuality(quality) {
      set({ quality });
    },
    issueCameraCommand(type) {
      set({ cameraCommand: { type, nonce: Date.now() + Math.random() } });
    },

    async saveProject() {
      const { project, storage, save, history, dragging } = get();
      if (save.status === 'saving' || dragging) return false;
      if (!project || storage === 'offline') {
        set({
          save: {
            status: 'error',
            error: 'Not connected to the BuildView API. Changes cannot be saved until it is running.',
            lastSavedAt: save.lastSavedAt,
          },
        });
        return false;
      }
      const snapshot = history.present;
      set({ save: { status: 'saving', error: null, lastSavedAt: save.lastSavedAt } });
      try {
        // Nothing is marked saved until the server has confirmed it.
        const saved = await api.save(project.id, {
          baseRevision: project.revision,
          document: snapshot,
          editorMeta: { viewMode: get().viewMode },
        });
        const current = get().history.present;
        set({
          project: { id: saved.id, name: saved.name, revision: saved.revision },
          savedDoc: snapshot,
          dirty: isDirty(current, snapshot),
          save: { status: 'idle', error: null, lastSavedAt: Date.now() },
        });
        return true;
      } catch (e) {
        const message =
          e instanceof ApiError && e.code === 'revision_conflict'
            ? 'This project was changed elsewhere. Reload the page to get the latest version before saving.'
            : e instanceof Error
              ? e.message
              : 'Saving failed';
        set({ save: { status: 'error', error: message, lastSavedAt: get().save.lastSavedAt } });
        return false;
      }
    },

    async duplicateProject() {
      const { project, storage } = get();
      if (!project || storage === 'offline') return;
      // The server copies the last SAVED revision, so persist pending edits first.
      if (get().dirty && !(await get().saveProject())) return;
      try {
        const copy = await api.duplicate(project.id);
        get().loadProject(copy, storage ?? 'postgres');
      } catch (e) {
        set({
          save: {
            status: 'error',
            error: e instanceof Error ? `Duplicate failed: ${e.message}` : 'Duplicate failed',
            lastSavedAt: get().save.lastSavedAt,
          },
        });
      }
    },
  };
});

export const selectCanUndo = (s: EditorState) => canUndo(s.history);
export const selectCanRedo = (s: EditorState) => canRedo(s.history);
