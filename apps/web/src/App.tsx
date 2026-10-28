import { useEffect } from 'react';
import { useEditor } from './state/editorStore.ts';
import { LeftPanel } from './ui/LeftPanel.tsx';
import { PropertiesPanel } from './ui/PropertiesPanel.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { BottomStrip, Viewport } from './ui/Viewport.tsx';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
        // Let text fields handle their own keys, except the global save/undo chords on non-text inputs.
        if (!(target instanceof HTMLInputElement) || target.type === 'text') return;
      }
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
      } else if (mod && key === 's') {
        e.preventDefault();
        void s.saveProject();
      } else if (key === 'escape') {
        s.clearSelection();
      } else if (s.selection?.kind === 'furniture') {
        const id = s.selection.ids[0];
        if (!id) return;
        if (key === 'delete' || key === 'backspace') s.removeFurniture(id);
        else if (key === 'r') s.rotateFurnitureBy(id, e.shiftKey ? -Math.PI / 12 : Math.PI / 12);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}

export function App() {
  useShortcuts();
  useEffect(() => {
    void useEditor.getState().initialize();
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="hidden min-h-0 lg:block">
          <LeftPanel />
        </div>
        <main className="flex min-h-[26rem] min-w-0 flex-1 flex-col">
          <p className="border-b border-[var(--bv-border)] bg-[var(--bv-surface-0)] px-4 py-2 text-xs text-[var(--bv-text-dim)] lg:hidden">
            Phone and tablet view is limited: orbit, select and review. Full editing is designed for desktop.
          </p>
          <Viewport />
          <BottomStrip />
        </main>
        <div className="max-h-[40vh] min-h-0 overflow-hidden lg:max-h-none">
          <PropertiesPanel />
        </div>
      </div>
    </div>
  );
}
