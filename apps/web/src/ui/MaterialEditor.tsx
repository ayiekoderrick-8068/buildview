import { useEffect, useId, useState } from 'react';
import { FINISH_PRESETS, PAINT_PRESETS, type FinishType, type SurfaceMaterial } from '@buildview/shared';
import { Segmented, Slider, Swatch } from '@buildview/ui';
import { useEditor } from '../state/editorStore.ts';
import { paintTargets, useUi } from '../state/uiStore.ts';

const FINISH_OPTIONS = (Object.keys(FINISH_PRESETS) as FinishType[]).map((f) => ({
  value: f,
  label: FINISH_PRESETS[f].label,
}));

/** Approximate shaded-sphere preview driven by the real material values. */
export function MaterialPreview({ material }: { material: SurfaceMaterial }) {
  const gloss = 1 - material.roughness;
  const spec = Math.round(15 + gloss * 70);
  const size = Math.round(18 + material.roughness * 36);
  const metal = material.metalness;
  return (
    <div
      aria-label="Material preview"
      data-testid="material-preview"
      className="h-16 w-16 shrink-0 rounded-full shadow-[0_6px_18px_rgba(0,0,0,0.5)]"
      style={{
        background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,${spec / 100}) 0%, rgba(255,255,255,0) ${size}%), radial-gradient(circle at 40% 35%, ${material.color}, color-mix(in srgb, ${material.color} ${Math.round(
          70 - metal * 25,
        )}%, black) 75%, #000 130%)`,
      }}
    />
  );
}

/**
 * Edits the material of the current paint targets. Every control writes through the design engine,
 * which ignores settings that do not apply to the finish (so disabled controls reflect reality).
 */
export function MaterialEditor() {
  const doc = useEditor((s) => s.history.present);
  const selection = useEditor((s) => s.selection);
  const paint = useEditor((s) => s.paint);
  const scope = useUi((s) => s.paintScope);
  const targets = paintTargets(scope, selection, doc);
  const primary = targets[0] ? doc.surfaces[targets[0]] : undefined;

  const hexId = useId();
  const [hexDraft, setHexDraft] = useState('');
  useEffect(() => setHexDraft(primary?.color ?? ''), [primary?.color]);

  if (!primary) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--bv-border)] p-3 text-xs leading-relaxed text-[var(--bv-text-dim)]">
        Select a wall in the 3D view, or choose “All walls”, to edit its paint.
      </p>
    );
  }
  const finish = FINISH_PRESETS[primary.finish];
  const mixed = targets.some((id) => doc.surfaces[id]?.color !== primary.color);

  return (
    <div data-testid="material-editor">
      <div className="mb-4 flex items-center gap-4">
        <MaterialPreview material={primary} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--bv-text)]">
            {PAINT_PRESETS.find((p) => p.color.toUpperCase() === primary.color.toUpperCase())?.name ?? 'Custom colour'}
          </p>
          <p className="font-mono text-xs text-[var(--bv-text-dim)]" data-testid="current-color">
            {primary.color.toUpperCase()}
          </p>
          <p className="text-xs text-[var(--bv-text-faint)]">
            {finish.label} finish{mixed ? ' · mixed colours' : ''}
          </p>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-5 gap-2">
        {PAINT_PRESETS.map((p) => (
          <Swatch
            key={p.id}
            name={p.name}
            color={p.color}
            selected={primary.color.toUpperCase() === p.color.toUpperCase()}
            onClick={() => paint(targets, { color: p.color })}
          />
        ))}
        <label
          className="relative flex h-9 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-white/10 text-[10px] text-[var(--bv-text-dim)] hover:border-white/30 focus-within:outline-2 focus-within:outline-[var(--bv-accent)]"
          style={{ background: 'conic-gradient(#f66, #fd6, #6f8, #6df, #86f, #f6c, #f66)' }}
          title="Custom colour"
        >
          <span className="sr-only">Custom colour</span>
          <input
            type="color"
            aria-label="Custom colour"
            data-testid="custom-color"
            value={primary.color}
            onChange={(e) => paint(targets, { color: e.target.value }, 'color')}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <label htmlFor={hexId} className="text-xs text-[var(--bv-text-dim)]">
          Hex
        </label>
        <input
          id={hexId}
          data-testid="hex-input"
          value={hexDraft}
          onChange={(e) => {
            setHexDraft(e.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) paint(targets, { color: e.target.value }, 'color');
          }}
          spellCheck={false}
          className="h-8 w-28 rounded-md border border-[var(--bv-border)] bg-[var(--bv-surface-0)] px-2 font-mono text-xs text-[var(--bv-text)] focus:border-[var(--bv-accent)] focus:outline-none"
        />
      </div>

      <p className="mb-1.5 text-xs text-[var(--bv-text-dim)]">Finish</p>
      <Segmented
        label="Finish"
        value={primary.finish}
        options={FINISH_OPTIONS}
        onChange={(f) => paint(targets, { finish: f })}
      />
      <p className="mb-4 mt-1.5 text-[11px] text-[var(--bv-text-faint)]">{finish.description}</p>

      <Slider
        label="Roughness"
        testId="roughness"
        value={primary.roughness}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => paint(targets, { roughness: v }, 'roughness')}
      />
      <Slider
        label="Metalness"
        testId="metalness"
        value={primary.metalness}
        min={0}
        max={1}
        step={0.01}
        disabled={!finish.metalnessAdjustable}
        disabledReason="Only the Metallic finish uses metalness. Ordinary paint is non-metallic."
        onChange={(v) => paint(targets, { metalness: v }, 'metalness')}
      />
      <Slider
        label="Texture scale"
        testId="texture-scale"
        value={primary.textureScale}
        min={0.1}
        max={6}
        step={0.1}
        format={(v) => `${v.toFixed(1)}×`}
        disabled={!finish.textured}
        disabledReason="Plain paint has no texture. Choose the Plaster finish to scale its texture."
        onChange={(v) => paint(targets, { textureScale: v }, 'texture')}
      />
    </div>
  );
}

/** Compact colour palette for the left tool panel; writes to the same paint targets. */
export function PaintPalette() {
  const doc = useEditor((s) => s.history.present);
  const selection = useEditor((s) => s.selection);
  const paint = useEditor((s) => s.paint);
  const scope = useUi((s) => s.paintScope);
  const targets = paintTargets(scope, selection, doc);
  const current = targets[0] ? doc.surfaces[targets[0]]?.color.toUpperCase() : undefined;
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="paint-palette">
      {PAINT_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={targets.length === 0}
          aria-pressed={current === p.color.toUpperCase()}
          onClick={() => paint(targets, { color: p.color })}
          className="group flex flex-col items-stretch gap-1 rounded-lg p-1 text-left transition-colors hover:bg-[var(--bv-surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span
            className="h-10 rounded-md border border-white/10 transition-transform group-enabled:group-hover:scale-[1.03]"
            style={{
              background: p.color,
              outline: current === p.color.toUpperCase() ? '2px solid var(--bv-accent)' : undefined,
              outlineOffset: 2,
            }}
          />
          <span className="truncate text-[10px] text-[var(--bv-text-dim)]">{p.name}</span>
        </button>
      ))}
    </div>
  );
}

export function ScopeSelector() {
  const selection = useEditor((s) => s.selection);
  const scope = useUi((s) => s.paintScope);
  const setScope = useUi((s) => s.setPaintScope);
  const count = selection?.kind === 'wall' ? selection.ids.length : 0;
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-xs text-[var(--bv-text-dim)]">Apply changes to</p>
      <Segmented
        label="Apply changes to"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'selection', label: count > 1 ? `Selected walls (${count})` : 'This wall' },
          { value: 'all', label: 'All walls' },
        ]}
      />
    </div>
  );
}
