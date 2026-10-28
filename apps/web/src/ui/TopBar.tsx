import { useEffect, useState } from 'react';
import { AlertTriangle, Check, CircleDot, CloudOff, Copy, FilePlus2, Loader2, Redo2, Save, Sparkles, Undo2 } from 'lucide-react';
import { Button, IconButton, cx } from '@buildview/ui';
import type { ProjectSummary } from '@buildview/shared';
import { api } from '../api/client.ts';
import { selectCanRedo, selectCanUndo, useEditor, type WorkMode } from '../state/editorStore.ts';
import { createAndOpenProject, openExistingProject } from '../state/projects.ts';
import { useValidation } from '../state/useValidation.ts';

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#1b212a" />
        <path d="M8 23V12l8-5 8 5v11" fill="none" stroke="#d9ae62" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M13 23v-6h6v6" fill="none" stroke="#d9ae62" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-[var(--bv-text)]">
        BuildView <span className="text-[var(--bv-accent)]">AI</span>
      </span>
    </div>
  );
}

export function SaveIndicator() {
  const dirty = useEditor((s) => s.dirty);
  const save = useEditor((s) => s.save);
  const storage = useEditor((s) => s.storage);

  let tone = 'text-[var(--bv-ok)]';
  let icon = <Check size={14} />;
  let text = 'All changes saved';
  if (save.status === 'saving') {
    tone = 'text-[var(--bv-text-dim)]';
    icon = <Loader2 size={14} className="bv-spin" />;
    text = 'Saving…';
  } else if (save.status === 'error') {
    tone = 'text-[var(--bv-danger)]';
    icon = <AlertTriangle size={14} />;
    text = 'Save failed';
  } else if (storage === 'offline') {
    tone = 'text-[var(--bv-warn)]';
    icon = <CloudOff size={14} />;
    text = dirty ? 'Unsaved - offline' : 'Offline sample';
  } else if (dirty) {
    tone = 'text-[var(--bv-warn)]';
    icon = <CircleDot size={14} />;
    text = 'Unsaved changes';
  }
  return (
    <div role="status" aria-live="polite" data-testid="save-status" data-state={save.status === 'idle' ? (dirty ? 'dirty' : 'saved') : save.status} className={cx('flex items-center gap-1.5 text-xs font-medium', tone)}>
      {icon}
      {text}
    </div>
  );
}

function ProjectMenu() {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const current = useEditor((s) => s.project?.id);
  const offline = useEditor((s) => s.storage === 'offline');
  useEffect(() => {
    if (!open) return;
    setError(null);
    api.list().then(setProjects).catch((e: Error) => setError(e.message));
  }, [open]);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };
  return (
    <div className="relative">
      <IconButton label="Projects" onClick={() => setOpen((v) => !v)} disabled={offline} data-testid="project-menu" aria-expanded={open}>
        <FilePlus2 size={18} />
      </IconButton>
      {open ? (
        <div role="menu" className="bv-fade-in absolute right-0 top-11 z-50 w-72 rounded-xl border border-[var(--bv-border)] bg-[var(--bv-surface-1)] p-2 shadow-2xl">
          <button role="menuitem" type="button" data-testid="new-blank" className="w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--bv-text)] hover:bg-[var(--bv-surface-2)]" onClick={() => void run(() => createAndOpenProject('blank'))}>New blank project</button>
          <button role="menuitem" type="button" data-testid="new-sample" className="w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--bv-text)] hover:bg-[var(--bv-surface-2)]" onClick={() => void run(() => createAndOpenProject('sample'))}>New sample living room</button>
          <p className="mt-2 border-t border-[var(--bv-border)] px-3 pt-2 text-[10px] uppercase tracking-wider text-[var(--bv-text-faint)]">Open</p>
          <ul className="max-h-56 overflow-y-auto">
            {projects.slice(0, 20).map((p) => (
              <li key={p.id}>
                <button role="menuitem" type="button" disabled={p.id === current} className="flex w-full justify-between rounded-lg px-3 py-1.5 text-left text-xs text-[var(--bv-text-dim)] hover:bg-[var(--bv-surface-2)] disabled:text-[var(--bv-accent)]" onClick={() => void run(() => openExistingProject(p.id))}>
                  <span className="truncate">{p.name}</span>
                  <span className="font-mono text-[10px]">r{p.revision}</span>
                </button>
              </li>
            ))}
          </ul>
          {error ? <p role="alert" className="px-3 py-1 text-xs text-[var(--bv-danger)]">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

const NAV: Array<{ id: WorkMode; label: string }> = [
  { id: 'build', label: 'Build' },
  { id: 'design', label: 'Design' },
  { id: 'experience', label: 'Experience' },
];

export function TopBar() {
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const storage = useEditor((s) => s.storage);
  const saving = useEditor((s) => s.save.status === 'saving');
  const mode = useEditor((s) => s.mode);
  const walls = useEditor((s) => s.history.present.walls.length);
  const canUndo = useEditor(selectCanUndo);
  const canRedo = useEditor(selectCanRedo);
  const validation = useValidation();
  const { undo, redo, saveProject, duplicateProject, setMode } = useEditor.getState();

  const threeDBlocked = walls === 0 ? 'Draw or import walls in Build mode first.' : validation.blocking ? `${validation.critical} critical issue(s) in the plan must be fixed before the 3D house can be generated.` : null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--bv-border)] bg-[var(--bv-surface-1)] px-4">
      <Logo />
      <nav aria-label="Workspace" className="ml-4 hidden items-center gap-1 md:flex">
        {NAV.map((n) => {
          const blocked = n.id === 'build' ? null : threeDBlocked;
          return (
            <button
              key={n.id}
              type="button"
              data-testid={`mode-${n.id}`}
              disabled={!!blocked}
              aria-current={mode === n.id ? 'page' : undefined}
              title={blocked ?? n.label}
              onClick={() => setMode(n.id)}
              className={cx(
                'relative h-14 px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)]',
                mode === n.id ? 'font-medium text-[var(--bv-text)] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--bv-accent)]' : blocked ? 'cursor-not-allowed text-[var(--bv-text-faint)]' : 'text-[var(--bv-text-dim)] hover:text-[var(--bv-text)]',
              )}
            >
              {n.label}
            </button>
          );
        })}
      </nav>

      <div className="mx-auto flex min-w-0 flex-col items-center leading-tight">
        <span className="max-w-[18rem] truncate text-sm font-medium text-[var(--bv-text)]" data-testid="project-name">{project?.name ?? 'Sample living room (offline)'}</span>
        <SaveIndicator />
      </div>

      <div className="flex items-center gap-1">
        <ProjectMenu />
        <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} data-testid="undo"><Undo2 size={18} /></IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo} data-testid="redo"><Redo2 size={18} /></IconButton>
        <IconButton label="Duplicate project" disabled={!project || storage === 'offline'} onClick={() => void duplicateProject()} data-testid="duplicate"><Copy size={18} /></IconButton>
        <Button variant="secondary" disabled title="Offline rendering is not implemented yet. The viewport is a real-time preview." className="ml-2 hidden sm:inline-flex">
          <Sparkles size={16} /> Render
        </Button>
        <Button variant="primary" onClick={() => void saveProject()} disabled={saving || (!dirty && storage !== 'offline')} data-testid="save" className="ml-1">
          {saving ? <Loader2 size={16} className="bv-spin" /> : <Save size={16} />} Save Project
        </Button>
      </div>
    </header>
  );
}
