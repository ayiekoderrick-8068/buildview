import { Lamp, Paintbrush, Sofa, Trees, Frame, Moon, Sun, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Section, Segmented, Slider, Toggle, cx } from '@buildview/ui';
import { useEditor } from '../state/editorStore.ts';
import { useUi, type ToolId } from '../state/uiStore.ts';
import { PaintPalette, ScopeSelector } from './MaterialEditor.tsx';

const TOOLS: Array<{ id: ToolId; label: string; icon: ReactNode; available: boolean }> = [
  { id: 'paint', label: 'Paint', icon: <Paintbrush size={20} />, available: true },
  { id: 'furniture', label: 'Furniture', icon: <Sofa size={20} />, available: true },
  { id: 'lighting', label: 'Lighting', icon: <Lamp size={20} />, available: true },
  { id: 'decor', label: 'Décor', icon: <Frame size={20} />, available: false },
  { id: 'exterior', label: 'Exterior', icon: <Trees size={20} />, available: false },
];

function PaintTool() {
  const selection = useEditor((s) => s.selection);
  return (
    <>
      <Section title="Paint & materials">
        <p className="mb-3 text-xs leading-relaxed text-[var(--bv-text-dim)]">
          {selection?.kind === 'wall'
            ? `${selection.ids.length} wall${selection.ids.length > 1 ? 's' : ''} selected. Choose a colour below.`
            : 'Click a wall in the viewport (Shift-click to add more), then choose a colour.'}
        </p>
        <ScopeSelector />
        <PaintPalette />
        <p className="mt-3 text-[11px] leading-snug text-[var(--bv-text-faint)]">
          Finish, roughness and other material settings are in the Properties panel.
        </p>
      </Section>
    </>
  );
}

function FurnitureTool() {
  const furniture = useEditor((s) => s.history.present.furniture);
  const selection = useEditor((s) => s.selection);
  const selectFurniture = useEditor((s) => s.selectFurniture);
  const restore = useEditor((s) => s.restoreRemovedFurniture);
  return (
    <Section title="Furniture in this room">
      <ul className="space-y-1.5">
        {furniture.map((f) => {
          const selected = selection?.kind === 'furniture' && selection.ids.includes(f.id);
          return (
            <li key={f.id}>
              {f.deleted ? (
                <div className="flex items-center justify-between rounded-lg border border-dashed border-[var(--bv-border)] px-3 py-2 text-xs text-[var(--bv-text-faint)]">
                  <span className="line-through">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => restore(f.id)}
                    className="flex items-center gap-1 text-[var(--bv-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)]"
                  >
                    <Undo2 size={12} /> Restore
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => selectFurniture(f.id)}
                  aria-pressed={selected}
                  data-testid={`furniture-item-${f.id}`}
                  className={cx(
                    'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)]',
                    selected
                      ? 'border-[var(--bv-accent)]/60 bg-[var(--bv-accent)]/10 text-[var(--bv-text)]'
                      : 'border-[var(--bv-border)] bg-[var(--bv-surface-0)] text-[var(--bv-text-dim)] hover:text-[var(--bv-text)]',
                  )}
                >
                  <span>{f.name}</span>
                  {!f.movable ? <span className="text-[10px] uppercase tracking-wider text-[var(--bv-text-faint)]">wall-mounted</span> : null}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-[11px] leading-snug text-[var(--bv-text-faint)]">
        Select an object, then drag it in the viewport. Placement checks are basic (room bounds and overlap only).
      </p>
    </Section>
  );
}

function LightingTool() {
  const lighting = useEditor((s) => s.history.present.lighting);
  const update = useEditor((s) => s.updateLighting);
  return (
    <>
      <Section title="Time of day">
        <Segmented
          label="Lighting preset"
          value={lighting.preset}
          onChange={(preset) => update({ preset })}
          options={[
            { value: 'daylight', label: 'Daylight' },
            { value: 'evening', label: 'Warm evening' },
          ]}
        />
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--bv-text-faint)]">
          {lighting.preset === 'daylight' ? <Sun size={12} /> : <Moon size={12} />}
          {lighting.preset === 'daylight' ? 'Bright sun through the north window.' : 'Low warm light with interior lamps.'}
        </p>
      </Section>
      <Section title="Intensity">
        <Slider label="Ambient brightness" testId="ambient" value={lighting.ambient} min={0} max={2} step={0.05} onChange={(v) => update({ ambient: v })} />
        <Slider label="Sunlight intensity" testId="sun" value={lighting.sun} min={0} max={4} step={0.05} onChange={(v) => update({ sun: v })} />
        <div className="mt-2 border-t border-[var(--bv-border)] pt-2">
          <Toggle label="Interior lighting" testId="interior-toggle" checked={lighting.interior} onChange={(interior) => update({ interior })} />
        </div>
      </Section>
    </>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <Section title={title}>
      <p className="text-xs leading-relaxed text-[var(--bv-text-dim)]">
        This tool is not implemented yet. See the roadmap in docs/roadmap.md.
      </p>
    </Section>
  );
}

export function LeftPanel() {
  const tool = useUi((s) => s.tool);
  const setTool = useUi((s) => s.setTool);
  return (
    <div className="flex h-full min-h-0 border-r border-[var(--bv-border)] bg-[var(--bv-surface-1)]" data-testid="left-panel">
      <nav aria-label="Design tools" className="flex w-[4.5rem] shrink-0 flex-col items-stretch gap-1 border-r border-[var(--bv-border)] bg-[var(--bv-surface-0)] py-3">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={!t.available}
            title={t.available ? t.label : `${t.label} - coming in a later release`}
            aria-current={tool === t.id}
            data-testid={`tool-${t.id}`}
            onClick={() => setTool(t.id)}
            className={cx(
              'mx-1.5 flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] transition-colors',
              'focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)]',
              'disabled:cursor-not-allowed disabled:opacity-35',
              tool === t.id
                ? 'bg-[var(--bv-accent)]/15 text-[var(--bv-accent)]'
                : 'text-[var(--bv-text-dim)] hover:bg-[var(--bv-surface-2)] hover:text-[var(--bv-text)]',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 w-[17.5rem] overflow-y-auto" key={tool}>
        <div className="bv-fade-in">
          {tool === 'paint' ? <PaintTool /> : null}
          {tool === 'furniture' ? <FurnitureTool /> : null}
          {tool === 'lighting' ? <LightingTool /> : null}
          {tool === 'decor' ? <ComingSoon title="Décor" /> : null}
          {tool === 'exterior' ? <ComingSoon title="Exterior" /> : null}
        </div>
      </div>
    </div>
  );
}
