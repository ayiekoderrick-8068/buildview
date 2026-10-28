import { useEffect } from 'react';
import { cx } from '@buildview/ui';
import { useEditor } from './state/editorStore.ts';
import { useUi, type PlanTool } from './state/uiStore.ts';
import { useValidation } from './state/useValidation.ts';
import { BuildInspector, IssuesPanel } from './ui/BuildPanels.tsx';
import { LeftPanel } from './ui/LeftPanel.tsx';
import { PropertiesPanel } from './ui/PropertiesPanel.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { BottomStrip, Viewport } from './ui/Viewport.tsx';

const TOOL_KEYS: Record<string, PlanTool> = { v: 'select', w: 'wall', d: 'door', n: 'window', r: 'room', m: 'measure' };

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
        // Let text fields handle their own keys, except on non-text inputs (sliders, colour pickers).
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
      } else if (s.mode === 'build' && !mod) {
        if (TOOL_KEYS[key]) useUi.getState().setPlanTool(TOOL_KEYS[key]!);
        else if ((key === 'delete' || key === 'backspace') && s.selection) {
          e.preventDefault();
          s.deleteSelection();
        }
      } else if (s.mode === 'design' && s.selection?.kind === 'furniture') {
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

function BuildRight() {
  const tab = useUi((s) => s.rightTab);
  const setTab = useUi((s) => s.setRightTab);
  const v = useValidation();
  return (
    <aside aria-label="Inspector" className="flex h-full min-h-0 w-full flex-col border-l border-[var(--bv-border)] bg-[var(--bv-surface-1)] lg:w-[21rem]" data-testid="properties-panel">
      <div role="tablist" className="flex h-12 shrink-0 border-b border-[var(--bv-border)]">
        {(['inspector', 'issues'] as const).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} data-testid={`right-tab-${t}`} onClick={() => setTab(t)} className={cx('relative flex-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)]', tab === t ? 'font-medium text-[var(--bv-text)] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--bv-accent)]' : 'text-[var(--bv-text-dim)] hover:text-[var(--bv-text)]')}>
            {t === 'inspector' ? 'Inspector' : 'Validation'}
            {t === 'issues' && v.critical + v.warning > 0 ? (
              <span data-testid="issue-badge" className={cx('ml-2 rounded-full px-1.5 py-0.5 text-[10px]', v.critical ? 'bg-[var(--bv-danger)]/20 text-[var(--bv-danger)]' : 'bg-[var(--bv-warn)]/20 text-[var(--bv-warn)]')}>{v.critical + v.warning}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="bv-fade-in min-h-0 flex-1 overflow-y-auto" key={tab}>
        {tab === 'inspector' ? <BuildInspector /> : <IssuesPanel />}
      </div>
    </aside>
  );
}

export function App() {
  useShortcuts();
  const mode = useEditor((s) => s.mode);
  useEffect(() => {
    void useEditor.getState().initialize();
  }, []);

  return (
    <div className="flex h-full flex-col" data-mode={mode}>
      <TopBar />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="hidden min-h-0 lg:block">
          <LeftPanel />
        </div>
        <main className="flex min-h-[26rem] min-w-0 flex-1 flex-col">
          <p className="border-b border-[var(--bv-border)] bg-[var(--bv-surface-0)] px-4 py-2 text-xs text-[var(--bv-text-dim)] lg:hidden">
            Phone and tablet view is limited: orbit, select and review. Full plan and design editing is built for desktop.
          </p>
          <Viewport />
          <BottomStrip />
        </main>
        {mode === 'experience' ? null : (
          <div className="max-h-[40vh] min-h-0 overflow-hidden lg:max-h-none">{mode === 'build' ? <BuildRight /> : <PropertiesPanel />}</div>
        )}
      </div>
    </div>
  );
}
