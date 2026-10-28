import { useEffect, useState } from 'react';
import { Vector3 } from 'three';
import { formatLength, wallLength } from '@buildview/geometry-engine';
import { AlertTriangle, Box, Footprints, Images, Layers, Maximize, RotateCcw, Square, X } from 'lucide-react';
import { IconButton, Segmented, cx } from '@buildview/ui';
import { showDiagnostics } from '../debug.ts';
import { Studio } from '../scene/Studio.tsx';
import { sceneRegistry } from '../scene/registry.ts';
import { useEditor, type QualityLevel } from '../state/editorStore.ts';
import { useUi } from '../state/uiStore.ts';
import { useValidation } from '../state/useValidation.ts';
import { PlanEditor } from './PlanEditor.tsx';

function Diagnostics() {
  const [stats, setStats] = useState({ fps: 0, calls: 0, triangles: 0, geometries: 0, textures: 0, heap: 0 });
  useEffect(() => {
    let last = { frames: sceneRegistry.frameCount, at: performance.now() };
    const id = window.setInterval(() => {
      const now = performance.now();
      const frames = sceneRegistry.frameCount;
      const info = sceneRegistry.gl?.info;
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      setStats({
        fps: Math.round(((frames - last.frames) * 1000) / (now - last.at)),
        calls: info?.render.calls ?? 0,
        triangles: info?.render.triangles ?? 0,
        geometries: info?.memory.geometries ?? 0,
        textures: info?.memory.textures ?? 0,
        heap: mem ? Math.round(mem.usedJSHeapSize / 1048576) : 0,
      });
      last = { frames, at: now };
    }, 500);
    return () => window.clearInterval(id);
  }, []);
  return (
    <dl
      data-testid="diagnostics"
      className="pointer-events-none absolute right-3 top-20 z-20 grid grid-cols-[auto_auto] gap-x-3 rounded-lg border border-white/10 bg-black/60 px-3 py-2 font-mono text-[10px] text-white/80"
    >
      <dt>frames/s*</dt><dd className="text-right">{stats.fps}</dd>
      <dt>draw calls</dt><dd className="text-right">{stats.calls}</dd>
      <dt>triangles</dt><dd className="text-right">{stats.triangles.toLocaleString()}</dd>
      <dt>geometries</dt><dd className="text-right">{stats.geometries}</dd>
      <dt>textures</dt><dd className="text-right">{stats.textures}</dd>
      <dt>JS heap</dt><dd className="text-right">{stats.heap ? `${stats.heap} MB` : 'n/a'}</dd>
      <dd className="col-span-2 mt-1 text-white/40">*on-demand renderer: idle = 0</dd>
    </dl>
  );
}

function ViewControls() {
  const viewMode = useEditor((s) => s.viewMode);
  const setViewMode = useEditor((s) => s.setViewMode);
  const issue = useEditor((s) => s.issueCameraCommand);
  const quality = useEditor((s) => s.quality);
  const setQuality = useEditor((s) => s.setQuality);
  return (
    <>
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-xl border border-white/10 bg-black/55 p-1 backdrop-blur-md">
        <Segmented
          label="View mode"
          value={viewMode}
          onChange={setViewMode}
          options={[
            { value: '3d', label: '3D' },
            { value: '2d', label: '2D plan' },
          ]}
        />
        <IconButton label="Reset camera" onClick={() => issue('reset')} data-testid="camera-reset">
          <RotateCcw size={17} />
        </IconButton>
        <IconButton label="Fit room to view" onClick={() => issue('fit')} data-testid="camera-fit">
          <Maximize size={17} />
        </IconButton>
      </div>
      <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-xl border border-white/10 bg-black/55 px-2.5 py-1.5 text-xs text-white/80 backdrop-blur-md">
        <label htmlFor="quality" className="text-white/60">
          Quality
        </label>
        <select
          id="quality"
          value={quality}
          onChange={(e) => setQuality(e.target.value as QualityLevel)}
          className="rounded-md border border-white/10 bg-black/40 px-1.5 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)]"
        >
          <option value="high">High</option>
          <option value="balanced">Balanced</option>
          <option value="low">Low (fast)</option>
        </select>
      </div>
    </>
  );
}

function Hint() {
  const selection = useEditor((s) => s.selection);
  const text = selection
    ? selection.kind === 'wall'
      ? 'Wall selected · Shift-click to add walls · Esc to deselect'
      : 'Drag to move · R rotates · Delete removes optional items · Esc to deselect'
    : 'Drag to orbit · Right-drag to pan · Scroll to zoom · Click a wall or object';
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 hidden -translate-x-1/2 rounded-full md:block border border-white/10 bg-black/45 px-3.5 py-1.5 text-[11px] text-white/70 backdrop-blur-md">
      {text}
    </div>
  );
}

/**
 * Wall-length labels over the 3D view (selected walls, or all walls in the top-down view). They are
 * plain DOM elements positioned by projecting through the live camera, so no HTML lives inside the
 * WebGL canvas (which makes unmounting the canvas safe).
 */
function DimensionLabels3D() {
  const walls = useEditor((s) => s.history.present.walls);
  const selection = useEditor((s) => s.selection);
  const viewMode = useEditor((s) => s.viewMode);
  const unit = useUi((s) => s.displayUnit);
  const [labels, setLabels] = useState<Array<{ id: string; x: number; y: number; text: string }>>([]);
  useEffect(() => {
    const wanted = walls.filter((w) => viewMode === '2d' || (selection?.kind === 'wall' && selection.ids.includes(w.id)));
    if (wanted.length === 0) {
      setLabels([]);
      return;
    }
    const tick = () => {
      const { camera, gl } = sceneRegistry;
      if (!camera || !gl) return;
      camera.updateMatrixWorld();
      const rect = gl.domElement.getBoundingClientRect();
      setLabels(
        wanted.flatMap((w) => {
          const p = new Vector3((w.start.x + w.end.x) / 2, w.heightM + 0.15, -(w.start.y + w.end.y) / 2).project(camera);
          if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) return [];
          return [{ id: w.id, x: ((p.x + 1) / 2) * rect.width, y: ((1 - p.y) / 2) * rect.height, text: formatLength(wallLength(w), unit) }];
        }),
      );
    };
    tick();
    const t = window.setInterval(tick, 120);
    return () => window.clearInterval(t);
  }, [walls, selection, viewMode, unit]);
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true" data-testid="dimension-labels">
      {labels.map((l) => (
        <div key={l.id} style={{ left: l.x, top: l.y }} className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-white/10 bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white/90">{l.text}</div>
      ))}
    </div>
  );
}

/** Chooses what fills the workspace: the 2D plan editor (Build), the 3D studio (Design) or the walkthrough (Experience). */
function ViewportBody() {
  const mode = useEditor((s) => s.mode);
  const layout = useUi((s) => s.buildLayout);
  const setLayout = useUi((s) => s.setBuildLayout);
  if (mode === 'build') {
    return (
      <div className="flex h-full w-full" data-testid="build-workspace">
        <div className={cx('relative h-full min-w-0', layout === 'split' ? 'w-1/2 border-r border-[var(--bv-border)]' : 'w-full')}>
          <PlanEditor />
          <div className="absolute left-3 top-3 z-20 rounded-xl border border-white/10 bg-black/55 p-1 backdrop-blur-md">
            <Segmented label="Build layout" value={layout} onChange={setLayout} options={[{ value: '2d', label: '2D plan' }, { value: 'split', label: '2D + 3D' }]} />
          </div>
        </div>
        {layout === 'split' ? (
          <div className="relative h-full w-1/2 min-w-0" data-testid="split-3d">
            <Studio />
            <DimensionLabels3D />
            <div className="absolute bottom-3 left-3 rounded-lg border border-white/10 bg-black/55 px-2.5 py-1 text-[11px] text-white/70 backdrop-blur-md">Live 3D of the same model</div>
            {showDiagnostics ? <Diagnostics /> : null}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <>
      <Studio />
      <DimensionLabels3D />
      {mode === 'design' ? <ViewControls /> : null}
      {mode === 'design' ? <Hint /> : <WalkHint />}
      {showDiagnostics ? <Diagnostics /> : null}
    </>
  );
}

function WalkHint() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-black/45 px-3.5 py-1.5 text-[11px] text-white/70 backdrop-blur-md" data-testid="walk-hint">
      W A S D to walk · drag to look · you cannot pass through walls
    </div>
  );
}

export function Viewport() {
  const loadState = useEditor((s) => s.loadState);
  const loadError = useEditor((s) => s.loadError);
  const storage = useEditor((s) => s.storage);
  const saveError = useEditor((s) => s.save.error);
  const [dismissed, setDismissed] = useState<string | null>(null);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0b0e12]" data-testid="viewport">
      {loadState === 'ready' ? <ViewportBody /> : null}
      {loadState === 'loading' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-[var(--bv-text-dim)]" role="status">
          <Box className="bv-spin text-[var(--bv-accent)]" size={28} />
          Loading studio…
        </div>
      ) : null}

      {storage === 'memory' ? (
        <div className="absolute left-3 top-14 max-w-sm rounded-lg border border-[var(--bv-warn)]/40 bg-[var(--bv-warn)]/10 px-3 py-2 text-xs text-[var(--bv-warn)]" data-testid="memory-banner">
          Local development storage: projects are kept in server memory only and are lost when the API restarts.
        </div>
      ) : null}
      {storage === 'offline' ? (
        <div className="absolute left-3 top-14 max-w-sm rounded-lg border border-[var(--bv-danger)]/40 bg-[var(--bv-danger)]/10 px-3 py-2 text-xs text-[var(--bv-danger)]" role="alert" data-testid="offline-banner">
          The BuildView API is unreachable{loadError ? ` (${loadError})` : ''}. You can explore the sample room, but nothing can be saved.
        </div>
      ) : null}

      {saveError && saveError !== dismissed ? (
        <div
          role="alert"
          data-testid="save-error"
          className={cx(
            'bv-fade-in absolute bottom-16 left-1/2 flex max-w-md -translate-x-1/2 items-start gap-3 rounded-xl border',
            'border-[var(--bv-danger)]/50 bg-[#2a1614] px-4 py-3 text-sm text-[#ffd4cf] shadow-xl',
          )}
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--bv-danger)]" />
          <p className="leading-snug">{saveError}</p>
          <button type="button" aria-label="Dismiss" onClick={() => setDismissed(saveError)} className="shrink-0 text-white/60 hover:text-white">
            <X size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function BottomStrip() {
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const walls = useEditor((s) => s.history.present.walls.length);
  const validation = useValidation();
  const blocked = walls === 0 ? 'Draw or import walls first.' : validation.blocking ? 'Fix the critical plan issues first.' : undefined;
  const card = (
    label: string,
    icon: React.ReactNode,
    opts: { active?: boolean; onClick?: () => void; disabledReason?: string; testId?: string },
  ) => (
    <button
      type="button"
      disabled={!!opts.disabledReason}
      title={opts.disabledReason ?? label}
      onClick={opts.onClick}
      aria-pressed={opts.active}
      data-testid={opts.testId}
      className={cx(
        'flex h-14 min-w-[8.5rem] items-center gap-3 rounded-xl border px-4 text-left text-sm transition-colors',
        'focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        opts.active
          ? 'border-[var(--bv-accent)]/60 bg-[var(--bv-accent)]/10 text-[var(--bv-text)]'
          : 'border-[var(--bv-border)] bg-[var(--bv-surface-0)] text-[var(--bv-text-dim)] hover:text-[var(--bv-text)]',
      )}
    >
      <span className={opts.active ? 'text-[var(--bv-accent)]' : ''}>{icon}</span>
      <span className="flex flex-col leading-tight">
        <span>{label}</span>
        {opts.disabledReason ? <span className="text-[10px] text-[var(--bv-text-faint)]">{opts.disabledReason.length < 28 ? opts.disabledReason : 'Unavailable'}</span> : null}
      </span>
    </button>
  );
  return (
    <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-t border-[var(--bv-border)] bg-[var(--bv-surface-1)] px-4 py-3" data-testid="bottom-strip">
      {card('Floor plan', <Square size={18} />, { active: mode === 'build', onClick: () => setMode('build'), testId: 'strip-plan' })}
      {card('3D view', <Layers size={18} />, { active: mode === 'design', onClick: () => setMode('design'), testId: 'strip-3d', disabledReason: blocked })}
      {card('Walkthrough', <Footprints size={18} />, { active: mode === 'experience', onClick: () => setMode('experience'), testId: 'strip-walk', disabledReason: blocked })}
      {card('Alternative designs', <Images size={18} />, { disabledReason: 'Design alternatives are not implemented yet.' })}
    </div>
  );
}
