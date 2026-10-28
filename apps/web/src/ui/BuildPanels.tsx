import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertOctagon, AlertTriangle, Check, CheckCircle2, DoorOpen, Eye, EyeOff, FileUp, Info, Loader2, MousePointer2, PenLine, RectangleHorizontal, Ruler, Square, SquareDashed, Trash2, Wand2,
} from 'lucide-react';
import { DISPLAY_UNITS, formatLength, lengthToInputText, parseLength, polygonArea, wallDimensions, wallLength, type DisplayUnit, type LayerCategory } from '@buildview/geometry-engine';
import type { Opening, ValidationIssue } from '@buildview/shared';
import { Button, EmptyState, Section, Segmented, Toggle, cx } from '@buildview/ui';
import { useEditor } from '../state/editorStore.ts';
import { applyRecognition, detectedUnit, runRecognition, UNIT_LABEL, UNIT_TO_METRES, useImports, type ConfirmedUnit } from '../state/importStore.ts';
import { useUi, type PlanTool } from '../state/uiStore.ts';
import { useValidation } from '../state/useValidation.ts';

// ---------------------------------------------------------------- small controls

/** A length field that shows and accepts the active display unit; geometry stays in metres. */
export function LengthField({ label, value, onCommit, testId, disabled }: { label: string; value: number; onCommit: (m: number) => void; testId?: string; disabled?: boolean }) {
  const unit = useUi((s) => s.displayUnit);
  const [text, setText] = useState(lengthToInputText(value, unit));
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (!focused) {
      setText(lengthToInputText(value, unit));
      setBad(false);
    }
  }, [value, unit, focused]);
  const commit = () => {
    const parsed = parseLength(text, unit);
    if (parsed === null || !(parsed > 0)) {
      setBad(true);
      return;
    }
    setBad(false);
    if (Math.abs(parsed - value) > 1e-9) onCommit(parsed);
  };
  return (
    <label className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--bv-text-dim)]">
      <span>{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          data-testid={testId}
          aria-label={label}
          aria-invalid={bad}
          disabled={disabled}
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === 'Escape') {
              setText(lengthToInputText(value, unit));
              (e.target as HTMLInputElement).blur();
            }
          }}
          className={cx('h-8 w-28 rounded-md border bg-[var(--bv-surface-0)] px-2 text-right font-mono text-xs text-[var(--bv-text)] focus:outline-none disabled:opacity-50', bad ? 'border-[var(--bv-danger)]' : 'border-[var(--bv-border)] focus:border-[var(--bv-accent)]')}
        />
        <span className="w-7 text-[10px] text-[var(--bv-text-faint)]">{unit === 'ft-in' ? '' : unit}</span>
      </span>
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    manual: 'border-white/15 text-[var(--bv-text-dim)]',
    reviewed: 'border-[var(--bv-ok)]/50 text-[var(--bv-ok)]',
    detected: 'border-[var(--bv-warn)]/50 text-[var(--bv-warn)]',
    'needs-review': 'border-[var(--bv-danger)]/60 text-[var(--bv-danger)]',
  };
  return <span data-testid="verification-status" className={cx('rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider', map[status])}>{status}</span>;
}

// ---------------------------------------------------------------- left: plan tools

const PLAN_TOOLS: Array<{ id: PlanTool; label: string; key: string; icon: ReactNode }> = [
  { id: 'select', label: 'Select', key: 'V', icon: <MousePointer2 size={18} /> },
  { id: 'wall', label: 'Wall', key: 'W', icon: <PenLine size={18} /> },
  { id: 'door', label: 'Door', key: 'D', icon: <DoorOpen size={18} /> },
  { id: 'window', label: 'Window', key: 'N', icon: <RectangleHorizontal size={18} /> },
  { id: 'room', label: 'Room', key: 'R', icon: <SquareDashed size={18} /> },
  { id: 'measure', label: 'Measure', key: 'M', icon: <Ruler size={18} /> },
];

export function PlanToolsPanel() {
  const planTool = useUi((s) => s.planTool);
  const setPlanTool = useUi((s) => s.setPlanTool);
  const snap = useUi((s) => s.snap);
  const setSnap = useUi((s) => s.setSnap);
  const unit = useUi((s) => s.displayUnit);
  const setUnit = useUi((s) => s.setDisplayUnit);
  const measurements = useUi((s) => s.measurements);
  const clear = useUi((s) => s.clearMeasurements);
  const detectRooms = useEditor((s) => s.detectRooms);
  const walls = useEditor((s) => s.history.present.walls.length);
  return (
    <>
      <Section title="Plan tools">
        <div className="grid grid-cols-3 gap-2" role="toolbar" aria-label="Plan tools">
          {PLAN_TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={`plan-tool-${t.id}`}
              aria-pressed={planTool === t.id}
              title={`${t.label} (${t.key})`}
              onClick={() => setPlanTool(t.id)}
              className={cx(
                'flex flex-col items-center gap-1 rounded-lg border py-2.5 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)]',
                planTool === t.id ? 'border-[var(--bv-accent)]/60 bg-[var(--bv-accent)]/10 text-[var(--bv-accent)]' : 'border-[var(--bv-border)] bg-[var(--bv-surface-0)] text-[var(--bv-text-dim)] hover:text-[var(--bv-text)]',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <Button size="sm" className="mt-3 w-full" onClick={detectRooms} disabled={walls < 3} data-testid="detect-rooms">
          <Wand2 size={14} /> Detect rooms from walls
        </Button>
        {measurements.length > 0 ? (
          <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={clear}>
            <Trash2 size={14} /> Clear {measurements.length} measurement{measurements.length > 1 ? 's' : ''}
          </Button>
        ) : null}
      </Section>
      <Section title="Snapping & precision">
        <Toggle label="Snap" checked={snap.enabled} onChange={(enabled) => setSnap({ enabled })} testId="snap-toggle" />
        <div className={cx('mt-1 space-y-0.5 pl-1', !snap.enabled && 'pointer-events-none opacity-40')}>
          <Toggle label="Endpoints" checked={snap.endpoints} onChange={(endpoints) => setSnap({ endpoints })} />
          <Toggle label="Along walls" checked={snap.walls} onChange={(walls) => setSnap({ walls })} />
          <Toggle label="Grid" checked={snap.grid} onChange={(grid) => setSnap({ grid })} />
          <Toggle label="Straight lines (ortho)" checked={snap.ortho} onChange={(ortho) => setSnap({ ortho })} />
        </div>
        <label className="mt-3 flex items-center justify-between text-xs text-[var(--bv-text-dim)]">
          Grid spacing
          <select value={snap.gridM} onChange={(e) => setSnap({ gridM: Number(e.target.value) })} className="h-8 rounded-md border border-[var(--bv-border)] bg-[var(--bv-surface-0)] px-2 text-xs text-[var(--bv-text)]">
            {[0.01, 0.05, 0.1, 0.25, 0.5, 1].map((g) => <option key={g} value={g}>{g * 1000} mm</option>)}
          </select>
        </label>
        <p className="mt-2 text-[11px] leading-snug text-[var(--bv-text-faint)]">Snapping only moves a point when a target is within 10 screen pixels of the cursor; nothing is rounded outside that range. Stored lengths keep 0.01 mm resolution.</p>
        <label className="mt-3 flex items-center justify-between text-xs text-[var(--bv-text-dim)]">
          Display units
          <select data-testid="display-unit" value={unit} onChange={(e) => setUnit(e.target.value as DisplayUnit)} className="h-8 rounded-md border border-[var(--bv-border)] bg-[var(--bv-surface-0)] px-2 text-xs text-[var(--bv-text)]">
            {DISPLAY_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </label>
        <p className="mt-1 text-[11px] text-[var(--bv-text-faint)]">Changes how lengths are shown, never the geometry.</p>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- left: layers

export function LayersPanel() {
  const layers = useUi((s) => s.layers);
  const toggle = useUi((s) => s.toggleLayer);
  const hidden = useUi((s) => s.hiddenCadLayers);
  const toggleCad = useUi((s) => s.toggleCadLayer);
  const active = useImports((s) => s.active);
  const draft = useImports((s) => s.draft);
  const names: Array<[keyof typeof layers, string]> = [['grid', 'Grid'], ['underlay', 'CAD underlay'], ['walls', 'Walls'], ['openings', 'Doors & windows'], ['rooms', 'Rooms'], ['dimensions', 'Dimensions'], ['furniture', 'Furniture']];
  return (
    <>
      <Section title="Model layers">
        <ul className="space-y-1">
          {names.map(([k, label]) => (
            <li key={k}>
              <button type="button" onClick={() => toggle(k)} aria-pressed={layers[k]} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm text-[var(--bv-text-dim)] hover:bg-[var(--bv-surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)]">
                {label}
                {layers[k] ? <Eye size={15} className="text-[var(--bv-accent)]" /> : <EyeOff size={15} />}
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Drawing layers (CAD)">
        {active?.result ? (
          <ul className="space-y-1">
            {active.result.layers.map((l) => (
              <li key={l.name}>
                <button type="button" onClick={() => toggleCad(l.name)} aria-pressed={!hidden.includes(l.name)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs text-[var(--bv-text-dim)] hover:bg-[var(--bv-surface-2)]">
                  <span className="min-w-0 truncate">
                    <span className="font-mono">{l.name}</span> <span className="text-[var(--bv-text-faint)]">· {l.entityCount}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {draft.layerMap[l.name] && draft.layerMap[l.name] !== 'ignore' ? <span className="rounded bg-[var(--bv-accent)]/15 px-1.5 text-[10px] uppercase text-[var(--bv-accent)]">{draft.layerMap[l.name]}</span> : null}
                    {hidden.includes(l.name) ? <EyeOff size={14} /> : <Eye size={14} className="text-[var(--bv-accent)]" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--bv-text-dim)]">Import a drawing to inspect its layers.</p>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- left: import wizard

const CATEGORIES: Array<{ value: LayerCategory; label: string }> = [
  { value: 'wall', label: 'Walls' }, { value: 'door', label: 'Doors' }, { value: 'window', label: 'Windows' }, { value: 'room', label: 'Room outlines' }, { value: 'ignore', label: 'Ignore' },
];

export function ImportPanel() {
  const project = useEditor((s) => s.project);
  const storage = useEditor((s) => s.storage);
  const { jobs, active, draft, capabilities, uploading, error, refresh, upload, retry, open, patchDraft, confirmUnit } = useImports();
  const unit = useUi((s) => s.displayUnit);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickedUnit, setPickedUnit] = useState<ConfirmedUnit>('mm');
  const doc = useEditor((s) => s.history.present);

  useEffect(() => {
    if (project) void refresh(project.id);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const d = detectedUnit(active);
    if (d) setPickedUnit(d);
  }, [active]);

  // restore the underlay for a project that already has a source
  useEffect(() => {
    const src = doc.sources[doc.sources.length - 1];
    if (src && !useImports.getState().active) void useImports.getState().restore(src);
  }, [doc.sources]);

  const result = useMemo(() => runRecognition(active, draft), [active, draft]);
  const ready = !!project && storage !== 'offline';
  // Sanity-check size: the span of the wall-mapped line work (falls back to the whole drawing).
  const extentText = (() => {
    const res = active?.result;
    if (!res || !draft.confirmedUnit) return null;
    const k = UNIT_TO_METRES[draft.confirmedUnit];
    const xs: number[] = [];
    const ys: number[] = [];
    for (const e of res.entities) {
      if (draft.layerMap[e.layer] !== 'wall') continue;
      const pts: Array<[number, number]> =
        e.type === 'LINE'
          ? [e.a, e.b]
          : e.type === 'POLYLINE'
            ? e.points.map((p): [number, number] => [p[0], p[1]])
            : [[e.center[0] - e.radius, e.center[1] - e.radius], [e.center[0] + e.radius, e.center[1] + e.radius]];
      for (const [px, py] of pts) {
        xs.push(px);
        ys.push(py);
      }
    }
    const w = xs.length ? Math.max(...xs) - Math.min(...xs) : res.extents ? res.extents.max[0] - res.extents.min[0] : 0;
    const h = ys.length ? Math.max(...ys) - Math.min(...ys) : res.extents ? res.extents.max[1] - res.extents.min[1] : 0;
    return `${formatLength(w * k, unit)} × ${formatLength(h * k, unit)}`;
  })();

  return (
    <>
      <Section title="Upload drawing">
        <div className="mb-3 flex flex-wrap gap-1.5 text-[10px]" data-testid="capabilities">
          <span className={cx('rounded-full border px-2 py-0.5', capabilities?.dxf ? 'border-[var(--bv-ok)]/50 text-[var(--bv-ok)]' : 'border-[var(--bv-danger)]/50 text-[var(--bv-danger)]')}>DXF {capabilities?.dxf ? 'supported' : 'unavailable'}</span>
          <span title={capabilities?.dwgReason ?? ''} className={cx('rounded-full border px-2 py-0.5', capabilities?.dwg ? 'border-[var(--bv-ok)]/50 text-[var(--bv-ok)]' : 'border-white/20 text-[var(--bv-text-faint)]')}>DWG {capabilities?.dwg ? 'supported' : 'not available'}</span>
        </div>
        {capabilities && !capabilities.dwg ? <p className="mb-3 text-[11px] leading-snug text-[var(--bv-text-faint)]">DWG needs a licensed converter that is not installed. {capabilities.dwgReason ?? ''} Export the drawing as DXF.</p> : null}
        <input ref={fileRef} type="file" accept=".dxf,.dwg" hidden data-testid="import-file" onChange={(e) => { const f = e.target.files?.[0]; if (f && project) void upload(project.id, f); e.target.value = ''; }} />
        <Button variant="primary" className="w-full" disabled={!ready || uploading} onClick={() => fileRef.current?.click()} data-testid="import-button">
          {uploading ? <Loader2 size={16} className="bv-spin" /> : <FileUp size={16} />} Choose DXF / DWG file
        </Button>
        {!ready ? <p className="mt-2 text-[11px] text-[var(--bv-danger)]">Importing needs a saved project and a running API.</p> : null}
        <p className="mt-2 text-[11px] leading-snug text-[var(--bv-text-faint)]">The original file is stored unchanged and privately. Max {Math.round((capabilities?.maxUploadBytes ?? 26214400) / 1048576)} MB. No malware scanner is installed in this environment.</p>
        {error ? <p role="alert" className="mt-2 rounded-md border border-[var(--bv-danger)]/40 bg-[var(--bv-danger)]/10 px-2 py-1.5 text-xs text-[var(--bv-danger)]">{error}</p> : null}
      </Section>

      {jobs.length > 0 ? (
        <Section title="Imports">
          <ul className="space-y-1.5" data-testid="import-jobs">
            {jobs.map((j) => (
              <li key={j.id} className={cx('rounded-lg border px-3 py-2 text-xs', active?.id === j.id ? 'border-[var(--bv-accent)]/50 bg-[var(--bv-accent)]/5' : 'border-[var(--bv-border)] bg-[var(--bv-surface-0)]')}>
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => void open(j.id)} disabled={j.status !== 'succeeded'} className="min-w-0 truncate text-left font-medium text-[var(--bv-text)] disabled:cursor-default" title={j.fileName}>{j.fileName}</button>
                  <span data-testid="import-status" data-status={j.status} className={cx('flex items-center gap-1', j.status === 'succeeded' ? 'text-[var(--bv-ok)]' : j.status === 'failed' ? 'text-[var(--bv-danger)]' : 'text-[var(--bv-text-dim)]')}>
                    {j.status === 'queued' || j.status === 'running' ? <Loader2 size={12} className="bv-spin" /> : j.status === 'succeeded' ? <CheckCircle2 size={12} /> : <AlertOctagon size={12} />}
                    {j.status}
                  </span>
                </div>
                {j.status === 'failed' ? (
                  <p className="mt-1 leading-snug text-[var(--bv-danger)]" data-testid="import-error">{j.errorMessage}{j.errorCode !== 'dwg_unavailable' ? <button type="button" className="ml-2 underline" onClick={() => void retry(j.id)}>Retry</button> : null}</p>
                ) : null}
                <p className="mt-0.5 font-mono text-[10px] text-[var(--bv-text-faint)]">sha256 {j.sha256.slice(0, 12)}… · {(j.sizeBytes / 1024).toFixed(0)} KB</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {active?.result ? (
        <>
          <Section title="1 · Units & scale">
            <p className="mb-2 text-xs text-[var(--bv-text-dim)]" data-testid="detected-units">
              Drawing says: <strong className="text-[var(--bv-text)]">{active.result.units.name}</strong>
              {active.result.units.toMetres ? '' : ' - the scale is unknown, please choose it yourself.'}
            </p>
            {active.result.warnings.map((w) => <p key={w} className="mb-2 text-[11px] text-[var(--bv-warn)]">{w}</p>)}
            <div className="flex gap-2">
              <select aria-label="Drawing units" data-testid="unit-select" value={pickedUnit} onChange={(e) => setPickedUnit(e.target.value as ConfirmedUnit)} className="h-9 min-w-0 flex-1 rounded-md border border-[var(--bv-border)] bg-[var(--bv-surface-0)] px-2 text-xs text-[var(--bv-text)]">
                {(Object.keys(UNIT_LABEL) as ConfirmedUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
              </select>
              <Button size="sm" variant={draft.confirmedUnit === pickedUnit ? 'secondary' : 'primary'} onClick={() => confirmUnit(pickedUnit)} data-testid="confirm-units">
                {draft.confirmedUnit === pickedUnit ? <Check size={14} /> : null} {draft.confirmedUnit === pickedUnit ? 'Confirmed' : 'Confirm units'}
              </Button>
            </div>
            {extentText ? <p className="mt-2 text-xs text-[var(--bv-text-dim)]" data-testid="drawing-size">At this scale the drawing is <strong className="text-[var(--bv-text)]">{extentText}</strong>. Check this looks right for the building.</p> : <p className="mt-2 text-[11px] text-[var(--bv-text-faint)]">Nothing is recognised until you confirm the units.</p>}
          </Section>

          {draft.confirmedUnit ? (
            <>
              <Section title="2 · Layers">
                <table className="w-full text-xs" data-testid="layer-table">
                  <tbody>
                    {active.result.layers.filter((l) => l.entityCount > 0).map((l) => (
                      <tr key={l.name} className="border-b border-[var(--bv-border)] last:border-0">
                        <td className="max-w-[7rem] truncate py-1.5 pr-2 font-mono text-[var(--bv-text-dim)]" title={`${l.name}: ${Object.entries(l.types).map(([t, n]) => `${n} ${t}`).join(', ')}`}>{l.name}</td>
                        <td className="py-1.5 text-right">
                          <select aria-label={`Category for layer ${l.name}`} data-testid={`layer-${l.name}`} value={draft.layerMap[l.name] ?? 'ignore'} onChange={(e) => patchDraft({ layerMap: { ...draft.layerMap, [l.name]: e.target.value as LayerCategory } })} className="h-7 rounded-md border border-[var(--bv-border)] bg-[var(--bv-surface-0)] px-1 text-[11px] text-[var(--bv-text)]">
                            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {active.result.unsupported.length > 0 ? (
                  <div className="mt-2 rounded-md bg-[var(--bv-surface-0)] p-2 text-[11px] text-[var(--bv-text-dim)]" data-testid="unsupported-list">
                    <p className="mb-1 font-medium text-[var(--bv-text)]">Not interpreted</p>
                    {active.result.unsupported.map((u) => <p key={u.type}>{u.count} × {u.type}</p>)}
                  </div>
                ) : null}
              </Section>

              <Section title="3 · Walls">
                <Segmented label="Wall representation" value={draft.wallMode} onChange={(wallMode) => patchDraft({ wallMode })} options={[{ value: 'centerline', label: 'Centre lines' }, { value: 'double-line', label: 'Double lines' }]} />
                <p className="mb-3 mt-1.5 text-[11px] text-[var(--bv-text-faint)]">{draft.wallMode === 'centerline' ? 'Each line is a wall centre line. Thickness is not in the drawing, so it is an assumption you set here.' : 'Pairs of parallel lines 50-500 mm apart become one wall; thickness is measured.'}</p>
                <MmField label="Assumed thickness" disabled={draft.wallMode !== 'centerline'} valueM={draft.defaultThicknessM} onChange={(defaultThicknessM) => patchDraft({ defaultThicknessM })} testId="import-thickness" />
                <MmField label="Wall height" valueM={draft.wallHeightM} onChange={(wallHeightM) => patchDraft({ wallHeightM })} testId="import-height" />
                <MmField label="Auto-join gaps up to" valueM={draft.closeGapM} allowZero onChange={(closeGapM) => patchDraft({ closeGapM })} testId="import-gap" />
              </Section>

              <Section title="4 · Review & apply">
                {result ? (
                  <>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs" data-testid="recognition-summary">
                      <dt className="text-[var(--bv-text-dim)]">Walls</dt><dd className="text-right font-mono" data-testid="rec-walls">{result.stats.walls}</dd>
                      <dt className="text-[var(--bv-text-dim)]">Doors & windows</dt><dd className="text-right font-mono" data-testid="rec-openings">{result.stats.openings}</dd>
                      <dt className="text-[var(--bv-text-dim)]">Rooms</dt><dd className="text-right font-mono" data-testid="rec-rooms">{result.stats.rooms}</dd>
                      <dt className="text-[var(--bv-text-dim)]">Gaps auto-joined</dt><dd className="text-right font-mono">{result.stats.gapsClosed}</dd>
                      <dt className="text-[var(--bv-text-dim)]">Duplicates merged</dt><dd className="text-right font-mono">{result.stats.duplicatesRemoved}</dd>
                    </dl>
                    <ul className="mt-2 space-y-1">
                      {result.issues.slice(0, 6).map((i, n) => <li key={n} className="flex gap-1.5 text-[11px] leading-snug text-[var(--bv-text-dim)]"><SeverityIcon severity={i.severity} size={12} />{i.message}</li>)}
                    </ul>
                    <Button variant="primary" className="mt-3 w-full" disabled={result.stats.walls === 0} onClick={() => { applyRecognition(active, draft, result); useUi.getState().setLeftTab('tools'); useUi.getState().setRightTab('issues'); }} data-testid="apply-import">
                      Apply to plan
                    </Button>
                    {result.stats.walls === 0 ? <p className="mt-2 text-[11px] text-[var(--bv-warn)]">No walls recognised. Map a layer to “Walls” above.</p> : <p className="mt-2 text-[11px] text-[var(--bv-text-faint)]">Replaces the current walls, doors, windows and rooms (undoable). Materials and furniture are kept.</p>}
                  </>
                ) : null}
              </Section>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function MmField({ label, valueM, onChange, testId, disabled, allowZero }: { label: string; valueM: number; onChange: (m: number) => void; testId: string; disabled?: boolean; allowZero?: boolean }) {
  const [text, setText] = useState(String(Math.round(valueM * 1000)));
  useEffect(() => setText(String(Math.round(valueM * 1000))), [valueM]);
  return (
    <label className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--bv-text-dim)]">
      {label}
      <span className="flex items-center gap-1.5">
        <input data-testid={testId} disabled={disabled} value={text} onChange={(e) => { setText(e.target.value); const v = Number(e.target.value); if (Number.isFinite(v) && (v > 0 || (allowZero && v >= 0))) onChange(v / 1000); }} className="h-8 w-20 rounded-md border border-[var(--bv-border)] bg-[var(--bv-surface-0)] px-2 text-right font-mono text-xs text-[var(--bv-text)] focus:border-[var(--bv-accent)] focus:outline-none disabled:opacity-40" />
        <span className="text-[10px] text-[var(--bv-text-faint)]">mm</span>
      </span>
    </label>
  );
}

export function SeverityIcon({ severity, size = 14 }: { severity: ValidationIssue['severity']; size?: number }) {
  if (severity === 'critical') return <AlertOctagon size={size} className="shrink-0 text-[var(--bv-danger)]" />;
  if (severity === 'warning') return <AlertTriangle size={size} className="shrink-0 text-[var(--bv-warn)]" />;
  return <Info size={size} className="shrink-0 text-[var(--bv-text-faint)]" />;
}

// ---------------------------------------------------------------- right: issues

export function IssuesPanel() {
  const v = useValidation();
  const doc = useEditor((s) => s.history.present);
  const { select, acknowledge, markSelectionReviewed, approve, setMode } = useEditor.getState();
  const [notice, setNotice] = useState<string | null>(null);
  const jump = (issue: ValidationIssue) => {
    const id = issue.elementIds[0];
    if (!id) return;
    if (doc.walls.some((w) => w.id === id)) select('wall', [id]);
    else if (doc.openings.some((o) => o.id === id)) select('opening', [id]);
    else if (doc.rooms.some((r) => r.id === id)) select('room', [id]);
    else if (doc.furniture.some((f) => f.id === id)) select('furniture', [id]);
  };
  const unreviewed = [...doc.walls, ...doc.openings, ...doc.rooms].filter((e) => e.verificationStatus === 'detected' || e.verificationStatus === 'needs-review').map((e) => e.id);
  return (
    <div data-testid="issues-panel">
      <Section title="Model validation">
        <div className="mb-3 flex gap-2 text-xs" data-testid="issue-counts">
          <span className="rounded-full border border-[var(--bv-danger)]/50 px-2.5 py-1 text-[var(--bv-danger)]" data-testid="count-critical">{v.critical} critical</span>
          <span className="rounded-full border border-[var(--bv-warn)]/50 px-2.5 py-1 text-[var(--bv-warn)]" data-testid="count-warning">{v.warning} warnings</span>
          <span className="rounded-full border border-white/15 px-2.5 py-1 text-[var(--bv-text-dim)]">{v.info} info</span>
        </div>
        <Button variant="primary" className="w-full" data-testid="generate-3d" disabled={doc.walls.length === 0} onClick={() => {
          const r = approve();
          if (!r.ok) setNotice(`Cannot generate: ${r.issues.filter((i) => i.severity === 'critical' && i.status === 'open').length} critical issue(s) must be fixed first.`);
          else { setNotice(null); setMode('design'); }
        }}>
          Approve & generate 3D house
        </Button>
        {doc.approval.status === 'approved' ? <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--bv-ok)]" data-testid="approved"><CheckCircle2 size={13} /> Model approved</p> : null}
        {notice ? <p role="alert" className="mt-2 text-xs text-[var(--bv-danger)]" data-testid="generate-blocked">{notice}</p> : null}
        {unreviewed.length > 0 ? (
          <Button size="sm" className="mt-2 w-full" onClick={() => markSelectionReviewed(unreviewed)} data-testid="mark-all-reviewed">
            <Check size={14} /> Mark {unreviewed.length} detected element{unreviewed.length > 1 ? 's' : ''} as reviewed
          </Button>
        ) : null}
      </Section>
      <Section title="Issues">
        {v.issues.length === 0 ? <EmptyState title="No issues" icon={<CheckCircle2 size={26} />}>The model passed every check.</EmptyState> : null}
        <ul className="space-y-2">
          {v.issues.map((i) => (
            <li key={i.key} data-testid="issue" data-code={i.code} data-severity={i.severity} data-status={i.status} className={cx('rounded-lg border p-2.5 text-xs', i.severity === 'critical' ? 'border-[var(--bv-danger)]/40 bg-[var(--bv-danger)]/5' : 'border-[var(--bv-border)] bg-[var(--bv-surface-0)]', i.status === 'acknowledged' && 'opacity-55')}>
              <div className="flex gap-2">
                <SeverityIcon severity={i.severity} />
                <div className="min-w-0 flex-1">
                  <p className="leading-snug text-[var(--bv-text)]">{i.message}</p>
                  {i.suggestion ? <p className="mt-1 leading-snug text-[var(--bv-text-dim)]">→ {i.suggestion}</p> : null}
                  {i.sourceHandles.length ? <p className="mt-1 font-mono text-[10px] text-[var(--bv-text-faint)]">CAD handle{i.sourceHandles.length > 1 ? 's' : ''}: {i.sourceHandles.slice(0, 4).join(', ')}</p> : null}
                  <div className="mt-1.5 flex items-center gap-3">
                    {i.elementIds.length > 0 ? <button type="button" onClick={() => jump(i)} className="text-[var(--bv-accent)] underline-offset-2 hover:underline">Show</button> : null}
                    {i.severity !== 'critical' ? (
                      <button type="button" onClick={() => acknowledge(i.key, i.status !== 'acknowledged')} className="text-[var(--bv-text-dim)] underline-offset-2 hover:underline">
                        {i.status === 'acknowledged' ? 'Re-open' : 'Acknowledge'}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- right: build inspector

const OPENING_KINDS: Array<{ value: Opening['kind']; label: string }> = [
  { value: 'door', label: 'Door' }, { value: 'doorway', label: 'Doorway' }, { value: 'window', label: 'Window' }, { value: 'glazed-door', label: 'Glazed door' },
];

export function BuildInspector() {
  const doc = useEditor((s) => s.history.present);
  const selection = useEditor((s) => s.selection);
  const store = useEditor.getState();
  const unit = useUi((s) => s.displayUnit);
  const f = (m: number) => formatLength(m, unit);

  if (selection?.kind === 'wall') {
    const wall = doc.walls.find((w) => w.id === selection.ids[0]);
    if (!wall) return null;
    const dims = wallDimensions(wall, doc.openings);
    const mine = doc.openings.filter((o) => o.wallId === wall.id);
    return (
      <>
        <Section title={selection.ids.length > 1 ? `Wall (1 of ${selection.ids.length})` : 'Wall'} aside={<StatusBadge status={wall.verificationStatus} />}>
          <p className="text-sm font-medium text-[var(--bv-text)]">{wall.name}</p>
          <p className="mb-3 font-mono text-[11px] text-[var(--bv-text-faint)]" data-testid="wall-id">{wall.id}</p>
          <LengthField label="Length" value={wallLength(wall)} onCommit={(m) => store.setWallLengthM(wall.id, m)} testId="field-length" />
          <LengthField label="Thickness" value={wall.thicknessM} onCommit={(m) => store.setWallThicknessM(wall.id, m)} testId="field-thickness" />
          <LengthField label="Height" value={wall.heightM} onCommit={(m) => store.setWallHeightM(wall.id, m)} testId="field-height" />
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between"><dt className="text-[var(--bv-text-dim)]">Start</dt><dd className="font-mono" data-testid="wall-start">{f(wall.start.x)}, {f(wall.start.y)}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--bv-text-dim)]">End</dt><dd className="font-mono" data-testid="wall-end">{f(wall.end.x)}, {f(wall.end.y)}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--bv-text-dim)]">Net face area</dt><dd className="font-mono">{dims.netAreaM2.toFixed(2)} m²</dd></div>
          </dl>
          <p className="mt-2 text-[11px] leading-snug text-[var(--bv-text-faint)]">Changing length moves the END point; joined walls follow it. Paint and finishes are edited in Design mode and never alter these numbers.</p>
          {wall.notes.map((n) => <p key={n} className="mt-1.5 text-[11px] text-[var(--bv-warn)]">• {n}</p>)}
          {wall.sourceHandles.length ? <p className="mt-2 font-mono text-[10px] text-[var(--bv-text-faint)]">CAD source: {wall.sourceHandles.slice(0, 6).join(', ')}</p> : null}
          <div className="mt-3 flex gap-2">
            {wall.verificationStatus === 'detected' || wall.verificationStatus === 'needs-review' ? <Button size="sm" onClick={() => store.markSelectionReviewed()} data-testid="mark-reviewed"><Check size={14} /> Mark reviewed</Button> : null}
            <Button size="sm" variant="danger" onClick={() => store.deleteSelection()} data-testid="delete-selection"><Trash2 size={14} /> Delete</Button>
          </div>
        </Section>
        {mine.length ? (
          <Section title="Openings on this wall">
            <ul className="space-y-1">{mine.map((o) => <li key={o.id}><button type="button" onClick={() => store.select('opening', [o.id])} className="flex w-full justify-between rounded-md bg-[var(--bv-surface-0)] px-2 py-1.5 text-xs text-[var(--bv-text-dim)] hover:text-[var(--bv-text)]"><span>{o.kind}</span><span className="font-mono">{f(o.widthM)}</span></button></li>)}</ul>
          </Section>
        ) : null}
      </>
    );
  }

  if (selection?.kind === 'opening') {
    const o = doc.openings.find((x) => x.id === selection.ids[0]);
    if (!o) return null;
    const wall = doc.walls.find((w) => w.id === o.wallId);
    return (
      <Section title="Opening" aside={<StatusBadge status={o.verificationStatus} />}>
        <p className="mb-1 font-mono text-[11px] text-[var(--bv-text-faint)]" data-testid="opening-id">{o.id} · on {wall?.name ?? o.wallId}</p>
        <label className="mb-2 flex items-center justify-between text-xs text-[var(--bv-text-dim)]">
          Type
          <select data-testid="opening-kind" value={o.kind} onChange={(e) => store.patchOpening(o.id, { kind: e.target.value as Opening['kind'] })} className="h-8 rounded-md border border-[var(--bv-border)] bg-[var(--bv-surface-0)] px-2 text-xs text-[var(--bv-text)]">
            {OPENING_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <LengthField label="Width" value={o.widthM} onCommit={(m) => store.patchOpening(o.id, { widthM: m })} testId="field-width" />
        <LengthField label="Height" value={o.heightM} onCommit={(m) => store.patchOpening(o.id, { heightM: m })} testId="field-oheight" />
        <LengthField label="Sill height" value={Math.max(o.sillM, 1e-6)} onCommit={(m) => store.patchOpening(o.id, { sillM: m })} testId="field-sill" />
        <LengthField label="Centre from wall start" value={o.offsetM} onCommit={(m) => store.moveOpeningTo(o.id, m)} testId="field-offset" />
        <p className="mt-1 text-[11px] leading-snug text-[var(--bv-text-faint)]">Drag the opening along its wall in the plan. It stops at the wall ends and neighbouring openings.</p>
        {o.notes.map((n) => <p key={n} className="mt-1.5 text-[11px] text-[var(--bv-warn)]">• {n}</p>)}
        <div className="mt-3 flex gap-2">
          {o.verificationStatus === 'detected' || o.verificationStatus === 'needs-review' ? <Button size="sm" onClick={() => store.markSelectionReviewed()}><Check size={14} /> Mark reviewed</Button> : null}
          <Button size="sm" variant="danger" onClick={() => store.deleteSelection()} data-testid="delete-selection"><Trash2 size={14} /> Delete</Button>
        </div>
      </Section>
    );
  }

  if (selection?.kind === 'room') {
    const r = doc.rooms.find((x) => x.id === selection.ids[0]);
    if (!r) return null;
    return (
      <Section title="Room" aside={<StatusBadge status={r.verificationStatus} />}>
        <p className="text-sm font-medium text-[var(--bv-text)]">{r.name}</p>
        <p className="mb-3 font-mono text-[11px] text-[var(--bv-text-faint)]" data-testid="room-id">{r.id}</p>
        <dl className="space-y-1 text-xs">
          <div className="flex justify-between"><dt className="text-[var(--bv-text-dim)]">Floor area</dt><dd className="font-mono" data-testid="room-area">{Math.abs(polygonArea(r.polygon)).toFixed(2)} m²</dd></div>
          <div className="flex justify-between"><dt className="text-[var(--bv-text-dim)]">Boundary points</dt><dd className="font-mono">{r.polygon.length}</dd></div>
        </dl>
        <p className="mt-2 text-[11px] text-[var(--bv-text-faint)]">Floor and ceiling finishes are edited in Design mode.</p>
        <Button size="sm" variant="danger" className="mt-3" onClick={() => store.deleteSelection()}><Trash2 size={14} /> Delete room</Button>
      </Section>
    );
  }

  const w = doc.walls.length;
  return (
    <>
      <EmptyState title="Nothing selected" icon={<Square size={26} />}>Select a wall, opening or room in the plan to edit its dimensions.</EmptyState>
      <Section title="Plan summary">
        <dl className="space-y-1 text-xs">
          <div className="flex justify-between"><dt className="text-[var(--bv-text-dim)]">Walls</dt><dd className="font-mono" data-testid="sum-walls">{w}</dd></div>
          <div className="flex justify-between"><dt className="text-[var(--bv-text-dim)]">Doors & windows</dt><dd className="font-mono" data-testid="sum-openings">{doc.openings.length}</dd></div>
          <div className="flex justify-between"><dt className="text-[var(--bv-text-dim)]">Rooms</dt><dd className="font-mono" data-testid="sum-rooms">{doc.rooms.length}</dd></div>
        </dl>
      </Section>
      <Section title="Roof">
        <Toggle label="Flat roof" checked={!!doc.roof} testId="roof-toggle" onChange={(on) => store.setRoofSettings(on ? { kind: 'flat', thicknessM: 0.2, overhangM: 0.3 } : null)} />
        {doc.roof ? (
          <>
            <LengthField label="Thickness" value={doc.roof.thicknessM} onCommit={(m) => store.setRoofSettings({ ...doc.roof!, thicknessM: m })} />
            <LengthField label="Overhang" value={Math.max(doc.roof.overhangM, 1e-6)} onCommit={(m) => store.setRoofSettings({ ...doc.roof!, overhangM: m })} />
          </>
        ) : null}
        <p className="mt-2 text-[11px] leading-snug text-[var(--bv-text-faint)]">Only a flat slab over the outline of the walls is supported; pitched or complex roofs are planned.</p>
      </Section>
    </>
  );
}
