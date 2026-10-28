import { create } from 'zustand';
import type { SceneDocument } from '@buildview/shared';
import type { Selection } from './editorStore.ts';

export type ToolId = 'paint' | 'furniture' | 'lighting' | 'decor' | 'exterior';
export type PaintScope = 'selection' | 'all';

interface UiState {
  tool: ToolId;
  paintScope: PaintScope;
  setTool: (tool: ToolId) => void;
  setPaintScope: (scope: PaintScope) => void;
}

export const useUi = create<UiState>()((set) => ({
  tool: 'paint',
  paintScope: 'selection',
  setTool: (tool) => set({ tool }),
  setPaintScope: (paintScope) => set({ paintScope }),
}));

/** Surface ids a paint action should write to, given the scope and the current selection. */
export function paintTargets(scope: PaintScope, selection: Selection, doc: SceneDocument): string[] {
  if (scope === 'all') return doc.walls.map((w) => w.id);
  return selection?.kind === 'wall' ? selection.ids : [];
}
