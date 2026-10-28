import { create } from 'zustand';
import {
  acknowledgeIssue,
  addOpening,
  addRoom,
  addWall,
  approveModel,
  canRedo,
  canUndo,
  commit,
  commitTransient,
  createHistory,
  createSampleDocument,
  deleteFurniture,
  deleteOpening,
  deleteRoom,
  deleteWall,
  detectMissingRooms,
  ensureSurfaces,
  markReviewed,
  moveFurniture,
  moveOpening,
  normalizeAngle,
  redo as redoHistory,
  replacePresent,
  resetFurniture,
  restoreFurniture,
  revokeApprovalIfEdited,
  rotateFurniture,
  setLighting,
  setRoof,
  setWallHeight,
  setWallLength,
  setWallThickness,
  undo as undoHistory,
  updateOpening,
  updateSurfaces,
  type History,
  type SurfacePatch,
} from '@buildview/design-engine';
import { hasBlockingIssues, validateDocument } from '@buildview/geometry-engine';
import type { Lighting, Opening, Project, Pt, SceneDocument, SourceRef, ValidationIssue, Vec2 } from '@buildview/shared';
import { api, ApiError } from '../api/client.ts';

export type ViewMode = '3d' | '2d';
export type WorkMode = 'build' | 'design' | 'experience';
export type QualityLevel = 'high' | 'balanced' | 'low';
export type StorageMode = 'postgres' | 'memory' | 'offline';
export type Selection = { kind: 'wall' | 'opening' | 'room' | 'furniture'; ids: string[] } | null;
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

  mode: WorkMode;
  selection: Selection;
  viewMode: ViewMode;
  quality: QualityLevel;
  cameraCommand: CameraCommand | null;
  /** True while a drag (furniture or plan editing) is in progress. */
  dragging: boolean;
  dragBase: SceneDocument | null;

  // lifecycle
  initialize: () => Promise<void>;
  loadProject: (project: Project, storage: StorageMode) => void;
  loadLocalSample: (reason: string) => void;
  setMode: (mode: WorkMode) => void;
  // selection
  select: (kind: NonNullable<Selection>['kind'], ids: string[]) => void;
  selectWall: (id: string, additive?: boolean) => void;
  selectFurniture: (id: string) => void;
  clearSelection: () => void;
  // appearance
  paint: (surfaceIds: string[], patch: SurfacePatch, coalesceKey?: string) => void;
  // transient drags
  beginDrag: () => void;
  dragEdit: (edit: (doc: SceneDocument) => SceneDocument) => void;
  dragFurnitureTo: (id: string, position: Vec2) => void;
  endDrag: () => void;
  // furniture
  rotateFurnitureBy: (id: string, deltaRad: number) => void;
  setFurnitureRotation: (id: string, rotationY: number) => void;
  resetFurnitureTransform: (id: string) => void;
  removeFurniture: (id: string) => void;
  restoreRemovedFurniture: (id: string) => void;
  updateLighting: (patch: Partial<Lighting>) => void;
  // plan editing
  addWallSegment: (start: Pt, end: Pt) => string | null;
  setWallLengthM: (id: string, lengthM: number) => void;
  setWallThicknessM: (id: string, m: number) => void;
  setWallHeightM: (id: string, m: number) => void;
  addOpeningAt: (kind: Opening['kind'], at: Pt) => string | null;
  moveOpeningTo: (id: string, offsetM: number) => void;
  patchOpening: (id: string, patch: Partial<Pick<Opening, 'widthM' | 'heightM' | 'sillM' | 'kind'>>) => void;
  addRoomPolygon: (polygon: Pt[]) => string | null;
  detectRooms: () => void;
  deleteSelection: () => void;
  markSelectionReviewed: (ids?: string[]) => void;
  acknowledge: (key: string, on: boolean) => void;
  setRoofSettings: (roof: SceneDocument['roof']) => void;
  approve: () => { ok: boolean; issues: ValidationIssue[] };
  applyImport: (parts: Pick<SceneDocument, 'levels' | 'walls' | 'openings' | 'rooms'>, source: SourceRef) => void;
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
  const exists = (id: string) => {
    switch (sel.kind) {
      case 'wall':
        return doc.walls.some((w) => w.id === id);
      case 'opening':
        return doc.openings.some((o) => o.id === id);
      case 'room':
        return doc.rooms.some((r) => r.id === id);
      case 'furniture':
        return doc.furniture.some((f) => f.id === id && !f.deleted);
    }
  };
  const ids = sel.ids.filter(exists);
  return ids.length ? { kind: sel.kind, ids } : null;
}

export const useEditor = create<EditorState>()((set, get) => {
  /** Apply a history transition and recompute derived state. */
  const apply = (history: History<SceneDocument>, extra: Partial<EditorState> = {}) => {
    const { savedDoc, selection } = get();
    set({ history, dirty: isDirty(history.present, savedDoc), selection: validSelection(selection, history.present), ...extra });
  };

  const commitDoc = (next: SceneDocument, key?: string) => {
    const h = get().history;
    if (next === h.present) return;
    apply(commit(h, revokeApprovalIfEdited(h.present, next), key ? { key } : {}));
  };

  const doc = () => get().history.present;

  return {
    loadState: 'loading',
    loadError: null,
    storage: null,
    project: null,
    history: createHistory(createSampleDocument()),
    savedDoc: null,
    dirty: false,
    save: { status: 'idle', error: null, lastSavedAt: null },
    mode: 'design',
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
      const requested = url.searchParams.get('mode');
      const mode: WorkMode = requested === 'build' || requested === 'design' || requested === 'experience' ? requested : project.document.walls.length === 0 ? 'build' : get().mode;
      set({
        loadState: 'ready',
        loadError: null,
        storage,
        project: { id: project.id, name: project.name, revision: project.revision },
        history: createHistory(project.document),
        savedDoc: project.document,
        dirty: false,
        selection: null,
        mode,
        save: { status: 'idle', error: null, lastSavedAt: null },
      });
    },

    loadLocalSample(reason) {
      const d = createSampleDocument();
      set({ loadState: 'ready', loadError: reason, storage: 'offline', project: null, history: createHistory(d), savedDoc: d, dirty: false, selection: null });
    },

    setMode(mode) {
      set({ mode, cameraCommand: { type: 'reset', nonce: Date.now() + Math.random() } });
    },

    select(kind, ids) {
      set({ selection: ids.length ? { kind, ids } : null });
    },
    selectWall(id, additive = false) {
      const { selection } = get();
      if (additive && selection?.kind === 'wall') {
        const ids = selection.ids.includes(id) ? selection.ids.filter((x) => x !== id) : [...selection.ids, id];
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
      commitDoc(updateSurfaces(doc(), surfaceIds, patch), coalesceKey);
    },

    beginDrag() {
      set({ dragging: true, dragBase: doc() });
    },
    dragEdit(edit) {
      const h = get().history;
      const next = edit(h.present);
      if (next === h.present) return;
      // Live updates are not recorded; the whole drag becomes one undo step in endDrag().
      set({ history: replacePresent(h, next), dirty: true });
    },
    dragFurnitureTo(id, position) {
      get().dragEdit((d) => moveFurniture(d, id, position));
    },
    endDrag() {
      const { history, dragBase, savedDoc } = get();
      if (!dragBase) return set({ dragging: false });
      const present = revokeApprovalIfEdited(dragBase, history.present);
      const next = commitTransient({ ...history, present }, dragBase);
      set({ history: next, dragging: false, dragBase: null, dirty: isDirty(next.present, savedDoc), selection: validSelection(get().selection, next.present) });
    },

    rotateFurnitureBy(id, deltaRad) {
      const item = doc().furniture.find((f) => f.id === id);
      if (item) commitDoc(rotateFurniture(doc(), id, item.rotationY + deltaRad));
    },
    setFurnitureRotation(id, rotationY) {
      commitDoc(rotateFurniture(doc(), id, normalizeAngle(rotationY)), `rotate:${id}`);
    },
    resetFurnitureTransform(id) {
      commitDoc(resetFurniture(doc(), id));
    },
    removeFurniture(id) {
      commitDoc(deleteFurniture(doc(), id));
    },
    restoreRemovedFurniture(id) {
      commitDoc(restoreFurniture(doc(), id));
    },
    updateLighting(patch) {
      const key = 'ambient' in patch ? 'light:ambient' : 'sun' in patch ? 'light:sun' : undefined;
      commitDoc(setLighting(doc(), patch), key);
    },

    addWallSegment(start, end) {
      const r = addWall(doc(), start, end);
      commitDoc(r.doc);
      return r.id;
    },
    setWallLengthM(id, m) {
      commitDoc(setWallLength(doc(), id, m));
    },
    setWallThicknessM(id, m) {
      commitDoc(setWallThickness(doc(), id, m), `thickness:${id}`);
    },
    setWallHeightM(id, m) {
      commitDoc(setWallHeight(doc(), id, m), `height:${id}`);
    },
    addOpeningAt(kind, at) {
      const r = addOpening(doc(), kind, at);
      commitDoc(r.doc);
      return r.id;
    },
    moveOpeningTo(id, offsetM) {
      commitDoc(moveOpening(doc(), id, offsetM));
    },
    patchOpening(id, patch) {
      commitDoc(updateOpening(doc(), id, patch), `opening:${id}`);
    },
    addRoomPolygon(polygon) {
      const r = addRoom(doc(), polygon);
      commitDoc(r.doc);
      return r.id;
    },
    detectRooms() {
      commitDoc(detectMissingRooms(doc()));
    },
    deleteSelection() {
      const sel = get().selection;
      if (!sel) return;
      let next = doc();
      for (const id of sel.ids) {
        if (sel.kind === 'wall') next = deleteWall(next, id);
        else if (sel.kind === 'opening') next = deleteOpening(next, id);
        else if (sel.kind === 'room') next = deleteRoom(next, id);
        else next = deleteFurniture(next, id);
      }
      commitDoc(next);
    },
    markSelectionReviewed(ids) {
      const target = ids ?? get().selection?.ids ?? [];
      commitDoc(markReviewed(doc(), target));
    },
    acknowledge(key, on) {
      commitDoc(acknowledgeIssue(doc(), key, on));
    },
    setRoofSettings(roof) {
      commitDoc(setRoof(doc(), roof));
    },
    approve() {
      const issues = validateDocument(doc());
      if (hasBlockingIssues(issues)) return { ok: false, issues };
      const approved = approveModel(doc(), new Date().toISOString());
      if (approved) commitDoc(approved);
      return { ok: !!approved, issues };
    },
    applyImport(parts, source) {
      const cur = doc();
      const next = ensureSurfaces({
        ...cur,
        ...parts,
        // Existing material assignments are kept by element id; furniture stays and is re-checked by validation.
        sources: [...cur.sources.filter((s) => s.sourceId !== source.sourceId), source],
        approval: { status: 'draft', approvedAt: null },
        acknowledgedIssues: [],
      });
      commitDoc(next);
      set({ selection: null });
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
      set({ viewMode: mode, cameraCommand: { type: 'reset', nonce: Date.now() + Math.random() } });
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
        set({ save: { status: 'error', error: 'Not connected to the BuildView API. Changes cannot be saved until it is running.', lastSavedAt: save.lastSavedAt } });
        return false;
      }
      const snapshot = history.present;
      set({ save: { status: 'saving', error: null, lastSavedAt: save.lastSavedAt } });
      try {
        // Nothing is marked saved until the server has confirmed it.
        const saved = await api.save(project.id, { baseRevision: project.revision, document: snapshot, editorMeta: { viewMode: get().viewMode, mode: get().mode } });
        set({
          project: { id: saved.id, name: saved.name, revision: saved.revision },
          savedDoc: snapshot,
          dirty: isDirty(get().history.present, snapshot),
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
        set({ save: { status: 'error', error: e instanceof Error ? `Duplicate failed: ${e.message}` : 'Duplicate failed', lastSavedAt: get().save.lastSavedAt } });
      }
    },
  };
});

export const selectCanUndo = (s: EditorState) => canUndo(s.history);
export const selectCanRedo = (s: EditorState) => canRedo(s.history);
