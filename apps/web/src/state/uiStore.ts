import { create } from 'zustand';
import type { DisplayUnit } from '@buildview/geometry-engine';
import type { SnapSettings } from '@buildview/design-engine';
import { ceilingSurfaceId, floorSurfaceId, type Pt, type SceneDocument } from '@buildview/shared';
import type { Selection } from './editorStore.ts';

export type ToolId = 'paint' | 'surfaces' | 'furniture' | 'lighting' | 'decor' | 'exterior';
export type PaintScope = 'selection' | 'all';
export type PlanTool = 'select' | 'wall' | 'door' | 'window' | 'room' | 'measure';
export type BuildLeftTab = 'tools' | 'import' | 'layers';
export type BuildRightTab = 'inspector' | 'issues';

export interface PlanLayers {
  grid: boolean;
  underlay: boolean;
  walls: boolean;
  openings: boolean;
  rooms: boolean;
  dimensions: boolean;
  furniture: boolean;
}

interface UiState {
  tool: ToolId;
  paintScope: PaintScope;
  planTool: PlanTool;
  snap: SnapSettings;
  displayUnit: DisplayUnit;
  buildLayout: '2d' | 'split';
  leftTab: BuildLeftTab;
  rightTab: BuildRightTab;
  layers: PlanLayers;
  hiddenCadLayers: string[];
  measurements: Array<{ a: Pt; b: Pt }>;
  setTool: (tool: ToolId) => void;
  setPaintScope: (scope: PaintScope) => void;
  setPlanTool: (tool: PlanTool) => void;
  setSnap: (patch: Partial<SnapSettings>) => void;
  setDisplayUnit: (unit: DisplayUnit) => void;
  setBuildLayout: (layout: '2d' | 'split') => void;
  setLeftTab: (tab: BuildLeftTab) => void;
  setRightTab: (tab: BuildRightTab) => void;
  toggleLayer: (key: keyof PlanLayers) => void;
  toggleCadLayer: (name: string) => void;
  addMeasurement: (m: { a: Pt; b: Pt }) => void;
  clearMeasurements: () => void;
}

export const useUi = create<UiState>()((set) => ({
  tool: 'paint',
  paintScope: 'selection',
  planTool: 'select',
  snap: { enabled: true, gridM: 0.1, radiusM: 0.12, endpoints: true, walls: true, grid: true, ortho: false },
  displayUnit: 'm',
  buildLayout: '2d',
  leftTab: 'tools',
  rightTab: 'inspector',
  layers: { grid: true, underlay: true, walls: true, openings: true, rooms: true, dimensions: true, furniture: true },
  hiddenCadLayers: [],
  measurements: [],
  setTool: (tool) => set({ tool }),
  setPaintScope: (paintScope) => set({ paintScope }),
  setPlanTool: (planTool) => set({ planTool }),
  setSnap: (patch) => set((s) => ({ snap: { ...s.snap, ...patch } })),
  setDisplayUnit: (displayUnit) => set({ displayUnit }),
  setBuildLayout: (buildLayout) => set({ buildLayout }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setRightTab: (rightTab) => set({ rightTab }),
  toggleLayer: (key) => set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
  toggleCadLayer: (name) => set((s) => ({ hiddenCadLayers: s.hiddenCadLayers.includes(name) ? s.hiddenCadLayers.filter((n) => n !== name) : [...s.hiddenCadLayers, name] })),
  addMeasurement: (m) => set((s) => ({ measurements: [...s.measurements, m].slice(-12) })),
  clearMeasurements: () => set({ measurements: [] }),
}));

/** Surface ids a paint action should write to, given the scope and the current selection. */
export function paintTargets(scope: PaintScope, selection: Selection, doc: SceneDocument): string[] {
  if (scope === 'all') return doc.walls.map((w) => w.id);
  if (selection?.kind === 'wall') return selection.ids;
  return [];
}

export const roomSurfaces = (roomId: string) => ({ floor: floorSurfaceId(roomId), ceiling: ceilingSurfaceId(roomId) });
