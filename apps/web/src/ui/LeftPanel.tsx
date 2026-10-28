import { Footprints, Frame, Lamp, LayoutGrid, Moon, Paintbrush, Sofa, Sun, Trees, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Section, Segmented, Slider, Toggle, cx } from '@buildview/ui';
import { useEditor } from '../state/editorStore.ts';
import { useUi, type ToolId } from '../state/uiStore.ts';
import { PaintPalette, ScopeSelector } from './MaterialEditor.tsx';
import { ImportPanel, LayersPanel, PlanToolsPanel } from './BuildPanels.tsx';

const TOOLS: Array<{ id: ToolId; label: string; icon: ReactNode; available: boolean }> = [
  { id: 'paint', label: 'Paint', icon: <Paintbrush size={20} />, available: true },
  { id: 'surfaces', label: 'Floors', icon: <LayoutGrid size={20} />, available: true },
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

function SurfacesTool() {
  const rooms = useEditor((s) => s.history.present.rooms);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  return (
    <Section title="Floors & ceilings">
      {rooms.length === 0 ? (
        <p className="text-xs text-[var(--bv-text-dim)]">No rooms yet. Detect or draw rooms in Build mode.</p>
      ) : (
        <ul className="space-y-1.5">
          {rooms.map((r) => {
            const on = selection?.kind === 'room' && selection.ids.includes(r.id);
            return (
              <li key={r.id}>
                <button type="button" data-testid={`room-item-${r.id}`} aria-pressed={on} onClick={() => select('room', [r.id])} className={cx('flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)]', on ? 'border-[var(--bv-accent)]/60 bg-[var(--bv-accent)]/10 text-[var(--bv-text)]' : 'border-[var(--bv-border)] bg-[var(--bv-surface-0)] text-[var(--bv-text-dim)] hover:text-[var(--bv-text)]')}>
                  {r.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-4 text-[11px] leading-snug text-[var(--bv-text-faint)]">Select a room (or click its floor in the 3D view), then edit the floor and ceiling finish in the Properties panel.</p>
    </Section>
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

function BuildLeft() {
  const tab = useUi((s) => s.leftTab);
  const setTab = useUi((s) => s.setLeftTab);
  const tabs: Array<[typeof tab, string]> = [['tools', 'Tools'], ['import', 'Import'], ['layers', 'Layers']];
  return (
    <div className="flex h-full min-h-0 w-[19rem] flex-col border-r border-[var(--bv-border)] bg-[var(--bv-surface-1)]" data-testid="left-panel">
      <div role="tablist" className="flex shrink-0 border-b border-[var(--bv-border)]">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} data-testid={`left-tab-${id}`} onClick={() => setTab(id)} className={cx('relative h-12 flex-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--bv-accent)]', tab === id ? 'font-medium text-[var(--bv-text)] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--bv-accent)]' : 'text-[var(--bv-text-dim)] hover:text-[var(--bv-text)]')}>
            {label}
          </button>
        ))}
      </div>
      <div className="bv-fade-in min-h-0 flex-1 overflow-y-auto" key={tab}>
        {tab === 'tools' ? <PlanToolsPanel /> : tab === 'import' ? <ImportPanel /> : <LayersPanel />}
      </div>
    </div>
  );
}

function ExperienceLeft() {
  return (
    <div className="w-[17.5rem] border-r border-[var(--bv-border)] bg-[var(--bv-surface-1)]" data-testid="left-panel">
      <Section title="Walkthrough">
        <p className="mb-3 flex items-center gap-2 text-sm text-[var(--bv-text)]"><Footprints size={16} className="text-[var(--bv-accent)]" /> First-person view</p>
        <ul className="space-y-1.5 text-xs text-[var(--bv-text-dim)]">
          <li><kbd className="rounded bg-[var(--bv-surface-3)] px-1.5">W A S D</kbd> move</li>
          <li><kbd className="rounded bg-[var(--bv-surface-3)] px-1.5">← →</kbd> turn</li>
          <li>Drag the view to look around</li>
        </ul>
        <p className="mt-4 text-[11px] leading-snug text-[var(--bv-text-faint)]">Walls and window sills block you; door openings can be walked through. There is no collision with furniture, stairs or gravity yet.</p>
      </Section>
    </div>
  );
}

export function LeftPanel() {
  const mode = useEditor((s) => s.mode);
  if (mode === 'build') return <BuildLeft />;
  if (mode === 'experience') return <ExperienceLeft />;
  return <DesignLeft />;
}

function DesignLeft() {
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
          {tool === 'surfaces' ? <SurfacesTool /> : null}
          {tool === 'furniture' ? <FurnitureTool /> : null}
          {tool === 'lighting' ? <LightingTool /> : null}
          {tool === 'decor' ? <ComingSoon title="Décor" /> : null}
          {tool === 'exterior' ? <ComingSoon title="Exterior" /> : null}
        </div>
      </div>
    </div>
  );
}
