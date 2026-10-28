import { create } from 'zustand';
import {
  DEFAULT_RECOGNITION,
  recognizeBuilding,
  suggestLayerMap,
  type LayerCategory,
  type RecognitionOptions,
  type RecognitionResult,
} from '@buildview/geometry-engine';
import type { Capabilities, ImportJob, SourceRef } from '@buildview/shared';
import { api, ApiError } from '../api/client.ts';
import { useEditor } from './editorStore.ts';

export type ConfirmedUnit = SourceRef['confirmedUnit'];
export const UNIT_TO_METRES: Record<ConfirmedUnit, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
export const UNIT_LABEL: Record<ConfirmedUnit, string> = { mm: 'Millimetres', cm: 'Centimetres', m: 'Metres', in: 'Inches', ft: 'Feet' };

export interface ImportDraft {
  /** Null until the architect explicitly confirms. Recognition never runs on an unconfirmed scale. */
  confirmedUnit: ConfirmedUnit | null;
  layerMap: Record<string, LayerCategory>;
  wallMode: RecognitionOptions['wallMode'];
  defaultThicknessM: number;
  wallHeightM: number;
  closeGapM: number;
}

interface ImportState {
  jobs: ImportJob[];
  /** Selected job including the parse result (geometry in drawing units). */
  active: ImportJob | null;
  draft: ImportDraft;
  capabilities: Capabilities | null;
  uploading: boolean;
  error: string | null;
  refresh: (projectId: string) => Promise<void>;
  upload: (projectId: string, file: File) => Promise<void>;
  retry: (jobId: string) => Promise<void>;
  open: (jobId: string) => Promise<void>;
  /** Reload the underlay for a project that already has a confirmed source. */
  restore: (source: SourceRef) => Promise<void>;
  patchDraft: (patch: Partial<ImportDraft>) => void;
  confirmUnit: (unit: ConfirmedUnit) => void;
  setCapabilities: (c: Capabilities | null) => void;
  reset: () => void;
}

const freshDraft = (): ImportDraft => ({ confirmedUnit: null, layerMap: {}, wallMode: DEFAULT_RECOGNITION.wallMode, defaultThicknessM: DEFAULT_RECOGNITION.defaultThicknessM, wallHeightM: DEFAULT_RECOGNITION.wallHeightM, closeGapM: DEFAULT_RECOGNITION.closeGapM });

/** Unit suggested by the drawing header, expressed in the confirmable set (or null if unknown). */
export function detectedUnit(job: ImportJob | null): ConfirmedUnit | null {
  const m = job?.result?.units.toMetres;
  if (!m) return null;
  return (Object.entries(UNIT_TO_METRES).find(([, v]) => Math.abs(v - m) < 1e-9)?.[0] as ConfirmedUnit | undefined) ?? null;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;

export const useImports = create<ImportState>()((set, get) => {
  const poll = (projectId: string, jobId: string, tries = 0) => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        const job = await api.getImport(jobId);
        set((s) => ({ jobs: s.jobs.map((j) => (j.id === job.id ? { ...job, result: null } : j)) }));
        if (job.status === 'queued' || job.status === 'running') {
          if (tries < 200) poll(projectId, jobId, tries + 1);
        } else if (get().active?.id === jobId || get().active === null) {
          await get().open(jobId);
        }
      } catch (e) {
        set({ error: e instanceof Error ? e.message : 'Lost contact with the API' });
      }
    }, tries === 0 ? 150 : 600);
  };

  return {
    jobs: [],
    active: null,
    draft: freshDraft(),
    capabilities: null,
    uploading: false,
    error: null,

    async refresh(projectId) {
      try {
        const [jobs, health] = await Promise.all([api.listImports(projectId), api.health()]);
        set({ jobs, capabilities: health.capabilities ?? null, error: null });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : 'Could not load imports' });
      }
    },

    async upload(projectId, file) {
      set({ uploading: true, error: null });
      try {
        const job = await api.uploadSource(projectId, file);
        set((s) => ({ jobs: [job, ...s.jobs], uploading: false, active: null, draft: freshDraft() }));
        poll(projectId, job.id);
      } catch (e) {
        set({ uploading: false, error: e instanceof ApiError ? e.message : 'Upload failed' });
      }
    },

    async retry(jobId) {
      try {
        const job = await api.retryImport(jobId);
        set((s) => ({ jobs: [job, ...s.jobs], error: null }));
        poll(job.projectId, job.id);
      } catch (e) {
        set({ error: e instanceof Error ? e.message : 'Retry failed' });
      }
    },

    async open(jobId) {
      try {
        const job = await api.getImport(jobId);
        const suggested = job.result ? suggestLayerMap(job.result.layers.map((l) => l.name)) : {};
        set({ active: job, draft: { ...freshDraft(), layerMap: suggested }, error: null });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : 'Could not open import' });
      }
    },

    async restore(source) {
      try {
        const job = await api.getImport(source.importJobId);
        set({ active: job, draft: { ...freshDraft(), confirmedUnit: source.confirmedUnit, layerMap: source.layerMap as Record<string, LayerCategory> } });
      } catch {
        /* underlay unavailable: the plan itself is stored in the document */
      }
    },

    patchDraft(patch) {
      set((s) => ({ draft: { ...s.draft, ...patch } }));
    },
    confirmUnit(unit) {
      set((s) => ({ draft: { ...s.draft, confirmedUnit: unit } }));
    },
    setCapabilities(capabilities) {
      set({ capabilities });
    },
    reset() {
      if (pollTimer) clearTimeout(pollTimer);
      set({ jobs: [], active: null, draft: freshDraft(), error: null });
    },
  };
});

export function recognitionOptions(draft: ImportDraft): RecognitionOptions | null {
  if (!draft.confirmedUnit) return null;
  return {
    ...DEFAULT_RECOGNITION,
    toMetres: UNIT_TO_METRES[draft.confirmedUnit],
    layerMap: draft.layerMap,
    wallMode: draft.wallMode,
    defaultThicknessM: draft.defaultThicknessM,
    wallHeightM: draft.wallHeightM,
    closeGapM: draft.closeGapM,
  };
}

/** Runs deterministic recognition for the active import with the architect's confirmed settings. */
export function runRecognition(job: ImportJob | null, draft: ImportDraft): RecognitionResult | null {
  const opts = recognitionOptions(draft);
  if (!job?.result || !opts) return null;
  return recognizeBuilding(job.result, opts);
}

/** Applies the recognised plan to the project (undoable) and records the source and the decisions made. */
export function applyRecognition(job: ImportJob, draft: ImportDraft, result: RecognitionResult) {
  if (!draft.confirmedUnit) return;
  const source: SourceRef = {
    sourceId: job.sourceId,
    importJobId: job.id,
    fileName: job.fileName,
    sha256: job.sha256,
    confirmedUnit: draft.confirmedUnit,
    toMetres: UNIT_TO_METRES[draft.confirmedUnit],
    layerMap: Object.fromEntries(Object.entries(draft.layerMap)) as SourceRef['layerMap'],
    originM: result.originM,
    issues: result.issues.slice(0, 200),
  };
  useEditor.getState().applyImport(result.parts, source);
}
