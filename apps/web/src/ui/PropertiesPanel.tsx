import { useState } from 'react';
import { RotateCcw, RotateCw, Trash2, MousePointerClick, Ruler, PencilRuler } from 'lucide-react';
import { polygonArea, wallDimensions } from '@buildview/geometry-engine';
import { ceilingSurfaceId, floorSurfaceId, type FurnitureItem, type Opening, type Room, type Wall } from '@buildview/shared';
import { Button, EmptyState, Section, Segmented, Slider } from '@buildview/ui';
import { useEditor } from '../state/editorStore.ts';
import { MaterialEditor, ScopeSelector } from './MaterialEditor.tsx';

const deg = (rad: number) => Math.round((rad * 180) / Math.PI);
const KIND_LABEL: Record<string, string> = { window: 'Window', 'glazed-door': 'Glazed door', doorway: 'Doorway', door: 'Door' };

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1 text-xs">
      <dt className="text-[var(--bv-text-dim)]">{label}</dt>
      <dd className="font-mono tabular-nums text-[var(--bv-text)]" data-testid={testId}>{value}</dd>
    </div>
  );
}

function WallProperties({ wall, count, openings }: { wall: Wall; count: number; openings: Opening[] }) {
  const dims = wallDimensions(wall, openings);
  const mine = openings.filter((o) => o.wallId === wall.id);
  return (
    <>
      <Section title={count > 1 ? `Wall (1 of ${count} selected)` : 'Wall'}>
        <p className="mb-1 text-sm font-medium text-[var(--bv-text)]">{wall.name}</p>
        <p className="mb-3 font-mono text-[11px] text-[var(--bv-text-faint)]" data-testid="wall-id">{wall.id}</p>
        <dl>
          <Row label="Length (centre line)" value={`${dims.lengthM.toFixed(2)} m`} testId="wall-length" />
          <Row label="Height" value={`${dims.heightM.toFixed(2)} m`} testId="wall-height" />
          <Row label="Thickness" value={`${dims.thicknessM.toFixed(2)} m`} testId="wall-thickness" />
          <Row label="Net face area" value={`${dims.netAreaM2.toFixed(2)} m²`} testId="wall-area" />
        </dl>
        {mine.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {mine.map((o) => (
              <li key={o.id} className="flex items-center gap-2 rounded-md bg-[var(--bv-surface-0)] px-2 py-1 text-[11px] text-[var(--bv-text-dim)]">
                <Ruler size={12} />
                {KIND_LABEL[o.kind] ?? o.kind} · {o.widthM.toFixed(2)} × {o.heightM.toFixed(2)} m
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-[11px] leading-snug text-[var(--bv-text-faint)]">Dimensions are structural and unaffected by paint or material changes. Edit them in Build mode.</p>
      </Section>
      <Section title="Paint & material">
        <ScopeSelector />
        <MaterialEditor />
      </Section>
    </>
  );
}

function RoomProperties({ room }: { room: Room }) {
  const [which, setWhich] = useState<'floor' | 'ceiling'>('floor');
  const id = which === 'floor' ? floorSurfaceId(room.id) : ceilingSurfaceId(room.id);
  return (
    <>
      <Section title="Room">
        <p className="mb-1 text-sm font-medium text-[var(--bv-text)]">{room.name}</p>
        <p className="mb-3 font-mono text-[11px] text-[var(--bv-text-faint)]" data-testid="room-id">{room.id}</p>
        <dl><Row label="Floor area" value={`${Math.abs(polygonArea(room.polygon)).toFixed(2)} m²`} testId="room-area" /></dl>
      </Section>
      <Section title="Floor & ceiling finish">
        <Segmented label="Surface" value={which} onChange={setWhich} options={[{ value: 'floor', label: 'Floor' }, { value: 'ceiling', label: 'Ceiling' }]} />
        <div className="mt-4"><MaterialEditor surfaceIds={[id]} /></div>
      </Section>
    </>
  );
}

function OpeningInfo({ opening }: { opening: Opening }) {
  const setMode = useEditor((s) => s.setMode);
  return (
    <Section title={KIND_LABEL[opening.kind] ?? 'Opening'}>
      <p className="mb-3 font-mono text-[11px] text-[var(--bv-text-faint)]">{opening.id} · {opening.wallId}</p>
      <dl>
        <Row label="Width" value={`${opening.widthM.toFixed(2)} m`} />
        <Row label="Height" value={`${opening.heightM.toFixed(2)} m`} />
        <Row label="Sill" value={`${opening.sillM.toFixed(2)} m`} />
      </dl>
      <Button size="sm" className="mt-3 w-full" onClick={() => setMode('build')}><PencilRuler size={14} /> Edit in Build mode</Button>
    </Section>
  );
}

function FurnitureProperties({ item }: { item: FurnitureItem }) {
  const { rotateFurnitureBy, setFurnitureRotation, resetFurnitureTransform, removeFurniture } = useEditor.getState();
  return (
    <>
      <Section title="Object">
        <p className="mb-1 text-sm font-medium text-[var(--bv-text)]">{item.name}</p>
        <p className="mb-3 font-mono text-[11px] text-[var(--bv-text-faint)]" data-testid="furniture-id">{item.id}</p>
        <dl>
          <Row label="Position X" value={`${item.position[0].toFixed(2)} m`} testId="furniture-x" />
          <Row label="Position Y (north)" value={`${item.position[1].toFixed(2)} m`} testId="furniture-z" />
          <Row label="Rotation" value={`${deg(item.rotationY)}°`} testId="furniture-rotation" />
          <Row label="Size (W×H×D)" value={item.size.map((n) => n.toFixed(2)).join(' × ')} />
        </dl>
      </Section>
      <Section title="Transform">
        {item.movable ? (
          <>
            <Slider label="Rotation" testId="rotation-slider" value={deg(item.rotationY)} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => setFurnitureRotation(item.id, (v * Math.PI) / 180)} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="sm" onClick={() => rotateFurnitureBy(item.id, -Math.PI / 12)} aria-label="Rotate left 15 degrees"><RotateCcw size={14} /> 15° left</Button>
              <Button size="sm" onClick={() => rotateFurnitureBy(item.id, Math.PI / 12)} aria-label="Rotate right 15 degrees"><RotateCw size={14} /> 15° right</Button>
              <Button size="sm" className="col-span-2" onClick={() => resetFurnitureTransform(item.id)}>Reset position</Button>
            </div>
            <p className="mt-3 text-[11px] leading-snug text-[var(--bv-text-faint)]">
              Drag the object in the viewport to move it along the floor. It stays inside a room and cannot overlap other furniture. This is a basic check only: there is no clearance, door-swing, or accessibility analysis yet.
            </p>
          </>
        ) : (
          <p className="text-xs leading-relaxed text-[var(--bv-text-dim)]">This object is wall-mounted and cannot be moved in this version.</p>
        )}
        {item.removable ? (
          <Button variant="danger" size="sm" className="mt-3 w-full" onClick={() => removeFurniture(item.id)}><Trash2 size={14} /> Remove from room</Button>
        ) : (
          <p className="mt-3 text-[11px] text-[var(--bv-text-faint)]">This is a core object and cannot be removed.</p>
        )}
      </Section>
    </>
  );
}

export function PropertiesPanel() {
  const doc = useEditor((s) => s.history.present);
  const selection = useEditor((s) => s.selection);

  let body;
  if (selection?.kind === 'wall') {
    const wall = doc.walls.find((w) => w.id === selection.ids[0]);
    body = wall ? <WallProperties wall={wall} count={selection.ids.length} openings={doc.openings} /> : null;
  } else if (selection?.kind === 'room') {
    const room = doc.rooms.find((r) => r.id === selection.ids[0]);
    body = room ? <RoomProperties key={room.id} room={room} /> : null;
  } else if (selection?.kind === 'opening') {
    const o = doc.openings.find((x) => x.id === selection.ids[0]);
    body = o ? <OpeningInfo opening={o} /> : null;
  } else if (selection?.kind === 'furniture') {
    const item = doc.furniture.find((f) => f.id === selection.ids[0]);
    body = item ? <FurnitureProperties item={item} /> : null;
  } else {
    body = (
      <>
        <EmptyState title="Nothing selected" icon={<MousePointerClick size={28} />}>
          Click a wall to inspect and paint it, a floor to change its finish, or a piece of furniture to move and rotate it. Shift-click adds more walls.
        </EmptyState>
        <Section title="Building">
          <dl>
            <Row label="Walls" value={String(doc.walls.length)} />
            <Row label="Rooms" value={String(doc.rooms.length)} />
            <Row label="Doors & windows" value={String(doc.openings.length)} />
            <Row label="Storey height" value={`${(doc.levels[0]?.heightM ?? 0).toFixed(2)} m`} />
          </dl>
        </Section>
      </>
    );
  }

  return (
    <aside aria-label="Properties" className="flex h-full min-h-0 w-full flex-col border-l border-[var(--bv-border)] bg-[var(--bv-surface-1)] lg:w-[21rem]" data-testid="properties-panel">
      <header className="flex h-12 shrink-0 items-center border-b border-[var(--bv-border)] px-4">
        <h2 className="text-sm font-semibold text-[var(--bv-text)]">Properties</h2>
      </header>
      <div key={selection ? `${selection.kind}:${selection.ids[0]}` : 'none'} className="bv-fade-in min-h-0 flex-1 overflow-y-auto">
        {body}
      </div>
    </aside>
  );
}
