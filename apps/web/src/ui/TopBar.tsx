import { AlertTriangle, Check, CircleDot, CloudOff, Copy, Loader2, Redo2, Save, Sparkles, Undo2 } from 'lucide-react';
import { Button, IconButton, cx } from '@buildview/ui';
import { selectCanRedo, selectCanUndo, useEditor } from '../state/editorStore.ts';

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
    <div
      role="status"
      aria-live="polite"
      data-testid="save-status"
      data-state={save.status === 'idle' ? (dirty ? 'dirty' : 'saved') : save.status}
      className={cx('flex items-center gap-1.5 text-xs font-medium', tone)}
    >
      {icon}
      {text}
    </div>
  );
}

const NAV = [
  { id: 'build', label: 'Build', available: false },
  { id: 'design', label: 'Design', available: true },
  { id: 'experience', label: 'Experience', available: false },
];

export function TopBar() {
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const storage = useEditor((s) => s.storage);
  const saving = useEditor((s) => s.save.status === 'saving');
  const canUndo = useEditor(selectCanUndo);
  const canRedo = useEditor(selectCanRedo);
  const { undo, redo, saveProject, duplicateProject } = useEditor.getState();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--bv-border)] bg-[var(--bv-surface-1)] px-4">
      <Logo />
      <nav aria-label="Workspace" className="ml-4 hidden items-center gap-1 md:flex">
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            disabled={!n.available}
            aria-current={n.available ? 'page' : undefined}
            title={n.available ? n.label : `${n.label} - coming in a later release`}
            className={cx(
              'relative h-14 px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)]',
              n.available
                ? 'font-medium text-[var(--bv-text)] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--bv-accent)]'
                : 'cursor-not-allowed text-[var(--bv-text-faint)]',
            )}
          >
            {n.label}
          </button>
        ))}
      </nav>

      <div className="mx-auto flex min-w-0 flex-col items-center leading-tight">
        <span className="max-w-[18rem] truncate text-sm font-medium text-[var(--bv-text)]" data-testid="project-name">
          {project?.name ?? 'Sample living room (offline)'}
        </span>
        <SaveIndicator />
      </div>

      <div className="flex items-center gap-1">
        <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} data-testid="undo">
          <Undo2 size={18} />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo} data-testid="redo">
          <Redo2 size={18} />
        </IconButton>
        <IconButton
          label="Duplicate project"
          disabled={!project || storage === 'offline'}
          onClick={() => void duplicateProject()}
          data-testid="duplicate"
        >
          <Copy size={18} />
        </IconButton>
        <Button
          variant="secondary"
          disabled
          title="Offline rendering is not implemented yet. The viewport is a real-time preview."
          className="ml-2 hidden sm:inline-flex"
        >
          <Sparkles size={16} /> Render
        </Button>
        <Button
          variant="primary"
          onClick={() => void saveProject()}
          disabled={saving || (!dirty && storage !== 'offline')}
          data-testid="save"
          className="ml-1"
        >
          {saving ? <Loader2 size={16} className="bv-spin" /> : <Save size={16} />} Save Project
        </Button>
      </div>
    </header>
  );
}
