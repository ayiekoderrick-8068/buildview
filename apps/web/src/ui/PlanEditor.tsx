import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { footprintCorners, formatLength, openingPlacement, wallDirection, wallExtensions, wallLength } from '@buildview/geometry-engine';
import { moveOpening, moveWallPoint, snapPoint, translateWall, type SnapKind } from '@buildview/design-engine';
import { IconButton } from '@buildview/ui';
import type { CadParseResult, Pt, SceneDocument, Wall } from '@buildview/shared';
import { useEditor } from '../state/editorStore.ts';
import { UNIT_TO_METRES, useImports } from '../state/importStore.ts';
import { useUi } from '../state/uiStore.ts';
import { useValidation } from '../state/useValidation.ts';
import { buildingBounds, polygonCentroid } from '../scene/buildingInfo.ts';
import { planViewRegistry } from '../scene/registry.ts';

const ACCENT = '#f0c070';
const CRIT = '#ef6b5f';
const WARN = '#e8b04a';
const SNAP_PX = 10;

interface View {
  cx: number;
  cy: number;
  scale: number; // pixels per metre
}

const arcPath = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += 360;
  const n = Math.max(2, Math.ceil(sweep / 10));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + (sweep * i) / n) * Math.PI) / 180;
    return `${i ? 'L' : 'M'}${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  }).join('');
};

/** Underlay: the original drawing as one path per CAD layer (cheap to render and to hide). */
function useUnderlayPaths(result: CadParseResult | null, toMetres: number | null, origin: Pt, hidden: string[]) {
  return useMemo(() => {
    if (!result || !toMetres) return [] as Array<{ layer: string; d: string }>;
    const k = toMetres;
    const P = (x: number, y: number) => `${(x * k - origin.x).toFixed(4)} ${(y * k - origin.y).toFixed(4)}`;
    const byLayer = new Map<string, string[]>();
    const push = (layer: string, d: string) => {
      if (!byLayer.has(layer)) byLayer.set(layer, []);
      byLayer.get(layer)!.push(d);
    };
    for (const e of result.entities) {
      if (hidden.includes(e.layer)) continue;
      if (e.type === 'LINE') push(e.layer, `M${P(...e.a)}L${P(...e.b)}`);
      else if (e.type === 'POLYLINE') push(e.layer, e.points.map((p, i) => `${i ? 'L' : 'M'}${P(p[0], p[1])}`).join('') + (e.closed ? 'Z' : ''));
      else if (e.type === 'ARC') push(e.layer, arcPath(e.center[0] * k - origin.x, e.center[1] * k - origin.y, e.radius * k, e.startDeg, e.endDeg));
      else push(e.layer, arcPath(e.center[0] * k - origin.x, e.center[1] * k - origin.y, e.radius * k, 0, 359.9));
    }
    return [...byLayer.entries()].map(([layer, parts]) => ({ layer, d: parts.join('') }));
  }, [result, toMetres, origin.x, origin.y, hidden]);
}

const WallsLayer = memo(function WallsLayer({ walls, selected, issueSeverity, ext }: { walls: Wall[]; selected: Set<string>; issueSeverity: Map<string, string>; ext: Map<string, { start: number; end: number }> }) {
  return (
    <g>
      {walls.map((w) => {
        const d = wallDirection(w);
        const e = ext.get(w.id) ?? { start: 0, end: 0 };
        const len = wallLength(w);
        const n = { x: -d.y, y: d.x };
        const h = w.thicknessM / 2;
        const a = { x: w.start.x - d.x * e.start, y: w.start.y - d.y * e.start };
        const b = { x: w.start.x + d.x * (len + e.end), y: w.start.y + d.y * (len + e.end) };
        const pts = [
          [a.x + n.x * h, a.y + n.y * h],
          [b.x + n.x * h, b.y + n.y * h],
          [b.x - n.x * h, b.y - n.y * h],
          [a.x - n.x * h, a.y - n.y * h],
        ]
          .map((p) => p.map((v) => v.toFixed(4)).join(','))
          .join(' ');
        const sev = issueSeverity.get(w.id);
        const isSel = selected.has(w.id);
        return (
          <polygon
            key={w.id}
            data-kind="wall"
            data-id={w.id}
            points={pts}
            fill={isSel ? ACCENT : '#c9ced6'}
            stroke={sev === 'critical' ? CRIT : sev === 'warning' ? WARN : isSel ? '#fff' : '#6b7480'}
            strokeWidth={sev && sev !== 'info' ? 2 : 1}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: 'pointer' }}
          />
        );
      })}
    </g>
  );
});

function OpeningsLayer({ doc, selected }: { doc: SceneDocument; selected: Set<string> }) {
  return (
    <g>
      {doc.openings.map((o) => {
        const w = doc.walls.find((x) => x.id === o.wallId);
        if (!w) return null;
        const { center, rotationY } = openingPlacement(w, o);
        const deg = (rotationY * 180) / Math.PI;
        const cx = center[0];
        const cy = -center[2];
        const half = o.widthM / 2;
        const t = w.thicknessM;
        const sel = selected.has(o.id);
        const stroke = sel ? ACCENT : '#2a3340';
        return (
          <g key={o.id} data-kind="opening" data-id={o.id} transform={`translate(${cx} ${cy}) rotate(${deg})`} style={{ cursor: 'ew-resize' }}>
            <rect x={-half} y={-t / 2 - 0.01} width={o.widthM} height={t + 0.02} fill="#10151c" />
            {o.kind === 'window' || o.kind === 'glazed-door' ? (
              <>
                <line x1={-half} x2={half} y1={-t / 4} y2={-t / 4} stroke="#7fb8e6" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                <line x1={-half} x2={half} y1={t / 4} y2={t / 4} stroke="#7fb8e6" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              </>
            ) : (
              <>
                <line x1={-half} x2={-half} y1={-t / 2} y2={t / 2} stroke="#c9ced6" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                <line x1={half} x2={half} y1={-t / 2} y2={t / 2} stroke="#c9ced6" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                {o.kind === 'door' ? (
                  <>
                    <line x1={-half} x2={-half} y1={0} y2={o.widthM} stroke="#c9ced6" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                    <path d={`M${-half} ${o.widthM}A${o.widthM} ${o.widthM} 0 0 1 ${half} 0`} fill="none" stroke="#6b7480" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
                  </>
                ) : null}
              </>
            )}
            <rect x={-half} y={-t / 2 - 0.02} width={o.widthM} height={t + 0.04} fill="transparent" stroke={sel ? stroke : 'none'} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </g>
  );
}

export function PlanEditor() {
  const doc = useEditor((s) => s.history.present);
  const selection = useEditor((s) => s.selection);
  const planTool = useUi((s) => s.planTool);
  const snap = useUi((s) => s.snap);
  const layers = useUi((s) => s.layers);
  const unit = useUi((s) => s.displayUnit);
  const hiddenCad = useUi((s) => s.hiddenCadLayers);
  const measurements = useUi((s) => s.measurements);
  const active = useImports((s) => s.active);
  const draft = useImports((s) => s.draft);
  const validation = useValidation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ cx: 0, cy: 0, scale: 60 });
  const [cursor, setCursor] = useState<{ p: Pt; kind: SnapKind } | null>(null);
  const [chain, setChain] = useState<Pt | null>(null);
  const [roomPts, setRoomPts] = useState<Pt[]>([]);
  const [measureStart, setMeasureStart] = useState<Pt | null>(null);
  const drag = useRef<null | { type: 'pan'; sx: number; sy: number; cx: number; cy: number; moved: boolean } | { type: 'endpoint'; wallId: string; which: 'start' | 'end' } | { type: 'wall'; wallId: string; origin: Pt; sx: number; sy: number; started: boolean } | { type: 'opening'; id: string }>(null);
  const spaceDown = useRef(false);

  const b = useMemo(() => buildingBounds(doc), [doc.walls, doc.rooms]); // eslint-disable-line react-hooks/exhaustive-deps
  const ext = useMemo(() => wallExtensions(doc.walls), [doc.walls]);
  const selected = useMemo(() => new Set(selection?.ids ?? []), [selection]);

  // size tracking
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 }));
    ro.observe(el);
    setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const pad = 80;
    const scale = Math.max(4, Math.min((size.w - pad) / Math.max(b.width, 1), (size.h - pad) / Math.max(b.depth, 1)));
    setView({ cx: b.center.x, cy: b.center.y, scale });
  }, [b, size.w, size.h]);
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && size.w > 50) {
      fit();
      fitted.current = true;
    }
  }, [fit, size.w]);
  // Re-frame when a drawing is imported. Never while drawing: the view must not jump under the pointer.
  const sourceCount = useRef(doc.sources.length);
  useEffect(() => {
    if (doc.sources.length !== sourceCount.current) {
      sourceCount.current = doc.sources.length;
      fit();
    }
  }, [doc.sources.length, fit]);

  // expose the live view transform to the test hook so tests can click real plan coordinates
  useEffect(() => {
    const el = containerRef.current;
    planViewRegistry.current = {
      toClient: (x: number, y: number) => {
        const r = el?.getBoundingClientRect();
        return { x: (r?.left ?? 0) + (x - view.cx) * view.scale + size.w / 2, y: (r?.top ?? 0) + size.h / 2 - (y - view.cy) * view.scale };
      },
      scale: view.scale,
    };
    return () => {
      planViewRegistry.current = null;
    };
  }, [view, size]);

  const toPlan = useCallback((sx: number, sy: number): Pt => ({ x: (sx - size.w / 2) / view.scale + view.cx, y: (size.h / 2 - sy) / view.scale + view.cy }), [size, view]);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = containerRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };
  const snapAt = useCallback(
    (p: Pt, shift: boolean, from?: Pt) => snapPoint(doc, p, { ...snap, radiusM: SNAP_PX / view.scale, ortho: snap.ortho || shift }, from),
    [doc, snap, view.scale],
  );

  // CAD underlay
  const toMetres = active && draft.confirmedUnit ? UNIT_TO_METRES[draft.confirmedUnit] : null;
  const origin = useMemo(() => {
    const src = doc.sources.find((s) => s.sourceId === active?.sourceId);
    if (src) return src.originM;
    // before the plan is applied, centre the underlay on its own extents
    const ex = active?.result?.extents;
    return ex && toMetres ? { x: ((ex.min[0] + ex.max[0]) / 2) * toMetres, y: ((ex.min[1] + ex.max[1]) / 2) * toMetres } : { x: 0, y: 0 };
  }, [active, doc.sources, toMetres]);
  const underlay = useUnderlayPaths(layers.underlay ? (active?.result ?? null) : null, toMetres, origin, hiddenCad);

  // ---------------------------------------------------------------- pointer handling
  const targetOf = (e: RPointerEvent) => {
    const el = (e.target as Element).closest('[data-kind]') as SVGElement | null;
    return el ? { kind: el.dataset['kind']!, id: el.dataset['id'] ?? '', which: el.dataset['which'] as 'start' | 'end' | undefined } : null;
  };

  const onPointerDown = (e: RPointerEvent) => {
    const { sx, sy } = local(e);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const store = useEditor.getState();
    const t = targetOf(e);
    if (e.button === 1 || e.button === 2 || spaceDown.current) {
      drag.current = { type: 'pan', sx, sy, cx: view.cx, cy: view.cy, moved: false };
      return;
    }
    if (planTool !== 'select') return; // drawing tools act on click (pointer up)
    if (t?.kind === 'handle' && t.which) {
      store.beginDrag();
      drag.current = { type: 'endpoint', wallId: t.id, which: t.which };
    } else if (t?.kind === 'opening') {
      store.select('opening', [t.id]);
      store.beginDrag();
      drag.current = { type: 'opening', id: t.id };
    } else if (t?.kind === 'wall') {
      store.selectWall(t.id, e.shiftKey);
      const w = store.history.present.walls.find((x) => x.id === t.id)!;
      drag.current = { type: 'wall', wallId: t.id, origin: toPlan(sx, sy), sx, sy, started: false };
      void w;
    } else if (t?.kind === 'room') {
      store.select('room', [t.id]);
    } else {
      drag.current = { type: 'pan', sx, sy, cx: view.cx, cy: view.cy, moved: false };
    }
  };

  const onPointerMove = (e: RPointerEvent) => {
    const { sx, sy } = local(e);
    const raw = toPlan(sx, sy);
    const d = drag.current;
    const store = useEditor.getState();
    if (d?.type === 'pan') {
      const dx = sx - d.sx;
      const dy = sy - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      setView((v) => ({ ...v, cx: d.cx - dx / v.scale, cy: d.cy + dy / v.scale }));
      return;
    }
    if (d?.type === 'endpoint') {
      const s = snapAt(raw, e.shiftKey);
      store.dragEdit(() => moveWallPointFromBase(store.dragBase!, d.wallId, d.which, s.point));
      setCursor({ p: s.point, kind: s.kind });
      return;
    }
    if (d?.type === 'opening') {
      const base = store.dragBase!;
      const o = base.openings.find((x) => x.id === d.id);
      const w = o && base.walls.find((x) => x.id === o.wallId);
      if (o && w) {
        const dir = wallDirection(w);
        const offset = (raw.x - w.start.x) * dir.x + (raw.y - w.start.y) * dir.y;
        store.dragEdit(() => moveOpeningFromBase(base, d.id, offset));
      }
      return;
    }
    if (d?.type === 'wall') {
      if (!d.started && Math.hypot(sx - d.sx, sy - d.sy) < 4) return;
      if (!d.started) {
        d.started = true;
        store.beginDrag();
      }
      const base = store.dragBase!;
      const w = base.walls.find((x) => x.id === d.wallId)!;
      const target = { x: w.start.x + (raw.x - d.origin.x), y: w.start.y + (raw.y - d.origin.y) };
      const s = snapAt(target, false);
      store.dragEdit(() => translateFromBase(base, d.wallId, s.point.x - w.start.x, s.point.y - w.start.y));
      return;
    }
    const from = planTool === 'wall' ? (chain ?? undefined) : planTool === 'measure' ? (measureStart ?? undefined) : roomPts[roomPts.length - 1];
    const s = snapAt(raw, e.shiftKey, from);
    setCursor({ p: s.point, kind: s.kind });
  };

  const onPointerUp = (e: RPointerEvent) => {
    const { sx, sy } = local(e);
    const d = drag.current;
    drag.current = null;
    const store = useEditor.getState();
    if (d?.type === 'pan') {
      if (!d.moved && e.button === 0 && planTool === 'select') store.clearSelection();
      if (!d.moved && e.button === 2 && planTool === 'wall') setChain(null);
      return;
    }
    if (d?.type === 'endpoint' || d?.type === 'opening' || (d?.type === 'wall' && d.started)) {
      store.endDrag();
      return;
    }
    if (d?.type === 'wall') return; // click only: selection already done
    if (e.button !== 0) return;
    const raw = toPlan(sx, sy);
    if (planTool === 'wall') {
      const s = snapAt(raw, e.shiftKey, chain ?? undefined);
      if (!chain) setChain(s.point);
      else {
        const id = store.addWallSegment(chain, s.point);
        if (id) store.select('wall', [id]);
        setChain(s.point);
      }
    } else if (planTool === 'door' || planTool === 'window') {
      const id = store.addOpeningAt(planTool, snapAt(raw, false).point);
      if (id) store.select('opening', [id]);
    } else if (planTool === 'room') {
      const s = snapAt(raw, e.shiftKey, roomPts[roomPts.length - 1]);
      const first = roomPts[0];
      if (first && roomPts.length >= 3 && Math.hypot(s.point.x - first.x, s.point.y - first.y) * view.scale < SNAP_PX * 1.5) {
        const id = store.addRoomPolygon(roomPts);
        if (id) store.select('room', [id]);
        setRoomPts([]);
      } else setRoomPts([...roomPts, s.point]);
    } else if (planTool === 'measure') {
      const s = snapAt(raw, e.shiftKey, measureStart ?? undefined);
      if (!measureStart) setMeasureStart(s.point);
      else {
        useUi.getState().addMeasurement({ a: measureStart, b: s.point });
        setMeasureStart(null);
      }
    }
  };

  // wheel zoom around the cursor (non-passive so the page does not scroll)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      setView((v) => {
        const k = Math.exp(-e.deltaY * 0.0015);
        const scale = Math.min(800, Math.max(3, v.scale * k));
        const px = (sx - size.w / 2) / v.scale + v.cx;
        const py = (size.h / 2 - sy) / v.scale + v.cy;
        return { scale, cx: px - (sx - size.w / 2) / scale, cy: py - (size.h / 2 - sy) / scale };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [size.w, size.h]);

  // keyboard: cancel/finish drawing, space to pan
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.code === 'Space') spaceDown.current = true;
      if (e.key === 'Escape') {
        setChain(null);
        setRoomPts([]);
        setMeasureStart(null);
      }
      if (e.key === 'Enter' && roomPts.length >= 3) {
        const id = useEditor.getState().addRoomPolygon(roomPts);
        if (id) useEditor.getState().select('room', [id]);
        setRoomPts([]);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [roomPts]);
  useEffect(() => {
    if (planTool !== 'wall') setChain(null);
    if (planTool !== 'room') setRoomPts([]);
    if (planTool !== 'measure') setMeasureStart(null);
  }, [planTool]);

  const S = view.scale;
  const sx = (x: number) => (x - view.cx) * S + size.w / 2;
  const sy = (y: number) => size.h / 2 - (y - view.cy) * S;
  const transform = `translate(${size.w / 2} ${size.h / 2}) scale(${S} ${-S}) translate(${-view.cx} ${-view.cy})`;

  // grid
  const grid = useMemo(() => {
    if (!layers.grid) return null;
    let step = snap.gridM > 0 ? snap.gridM : 0.1;
    while (step * S < 14) step *= 5; // keep lines >= 14 px apart
    const x0 = view.cx - size.w / 2 / S;
    const x1 = view.cx + size.w / 2 / S;
    const y0 = view.cy - size.h / 2 / S;
    const y1 = view.cy + size.h / 2 / S;
    const minor: string[] = [];
    const major: string[] = [];
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) (Math.abs(Math.round(x / (step * 5)) * step * 5 - x) < step / 100 ? major : minor).push(`M${x.toFixed(4)} ${y0}L${x.toFixed(4)} ${y1}`);
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) (Math.abs(Math.round(y / (step * 5)) * step * 5 - y) < step / 100 ? major : minor).push(`M${x0} ${y.toFixed(4)}L${x1} ${y.toFixed(4)}`);
    return { minor: minor.join(''), major: major.join('') };
  }, [layers.grid, snap.gridM, S, view.cx, view.cy, size.w, size.h]);

  const selWall = selection?.kind === 'wall' && selection.ids.length === 1 ? doc.walls.find((w) => w.id === selection.ids[0]) : undefined;
  const cursorText = cursor ? `${formatLength(cursor.p.x, unit)}, ${formatLength(cursor.p.y, unit)}` : '-';
  const hint =
    planTool === 'wall' ? (chain ? 'Click to place the next point · Shift = straight · Esc/right-click to finish' : 'Click to start a wall') :
    planTool === 'door' ? 'Click on a wall to place a door' :
    planTool === 'window' ? 'Click on a wall to place a window' :
    planTool === 'room' ? (roomPts.length >= 3 ? 'Click the first point or press Enter to close the room' : 'Click to add room boundary points') :
    planTool === 'measure' ? (measureStart ? 'Click the end point' : 'Click the start point') :
    'Click to select · drag handles to edit · drag empty space to pan · wheel to zoom';

  return (
    <div ref={containerRef} className="relative h-full w-full select-none overflow-hidden bg-[#10151c]" data-testid="plan-editor" onContextMenu={(e) => e.preventDefault()}>
      <svg
        width={size.w}
        height={size.h}
        data-testid="plan-svg"
        className="absolute inset-0 touch-none"
        style={{ cursor: planTool === 'select' ? (drag.current?.type === 'pan' ? 'grabbing' : 'default') : 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
      >
        <g transform={transform}>
          {grid ? (
            <>
              <path d={grid.minor} stroke="#1a212b" strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
              <path d={grid.major} stroke="#27313d" strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
            </>
          ) : null}
          <line x1={-0.5} x2={0.5} y1={0} y2={0} stroke="#3b4756" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line y1={-0.5} y2={0.5} x1={0} x2={0} stroke="#3b4756" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {underlay.map((u) => (
            <path key={u.layer} d={u.d} fill="none" stroke="#5d7088" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.75} />
          ))}
          {layers.rooms
            ? doc.rooms.map((r) => (
                <polygon
                  key={r.id}
                  data-kind="room"
                  data-id={r.id}
                  points={r.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill={selected.has(r.id) ? 'rgba(240,192,112,0.28)' : 'rgba(120,160,210,0.12)'}
                  stroke={selected.has(r.id) ? ACCENT : 'none'}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))
            : null}
          {layers.furniture
            ? doc.furniture.filter((f) => !f.deleted && f.kind !== 'wall-art').map((f) => (
                <polygon key={f.id} points={footprintCorners({ position: f.position, rotationY: f.rotationY, size: f.size }).map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(217,174,98,0.16)" stroke="#8a7447" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
              ))
            : null}
          {layers.walls ? <WallsLayer walls={doc.walls} selected={selected} issueSeverity={validation.byElement} ext={ext} /> : null}
          {layers.openings ? <OpeningsLayer doc={doc} selected={selected} /> : null}
          {selWall && planTool === 'select'
            ? (['start', 'end'] as const).map((which) => (
                <circle key={which} data-kind="handle" data-id={selWall.id} data-which={which} cx={selWall[which].x} cy={selWall[which].y} r={6 / S} fill="#fff" stroke={ACCENT} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ cursor: 'grab' }} />
              ))
            : null}
          {chain && cursor ? <line x1={chain.x} y1={chain.y} x2={cursor.p.x} y2={cursor.p.y} stroke={ACCENT} strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" /> : null}
          {roomPts.length > 0 ? (
            <polyline points={[...roomPts, ...(cursor ? [cursor.p] : [])].map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(240,192,112,0.12)" stroke={ACCENT} strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          ) : null}
          {measureStart && cursor ? <line x1={measureStart.x} y1={measureStart.y} x2={cursor.p.x} y2={cursor.p.y} stroke="#62c58b" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null}
          {measurements.map((m, i) => (
            <line key={i} x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke="#62c58b" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ))}
          {cursor && planTool !== 'select' ? <circle cx={cursor.p.x} cy={cursor.p.y} r={5 / S} fill="none" stroke={cursor.kind === 'none' ? '#8a96a6' : '#62c58b'} strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null}
        </g>

        {/* screen-space labels */}
        {layers.rooms
          ? doc.rooms.map((r) => {
              const c = polygonCentroid(r.polygon);
              const area = Math.abs(r.polygon.reduce((a, p, i) => a + (p.x * r.polygon[(i + 1) % r.polygon.length]!.y - r.polygon[(i + 1) % r.polygon.length]!.x * p.y), 0) / 2);
              return (
                <text key={r.id} x={sx(c.x)} y={sy(c.y)} textAnchor="middle" fontSize={12} fill="#9fb3cc" pointerEvents="none">
                  <tspan x={sx(c.x)} dy="0">{r.name}</tspan>
                  <tspan x={sx(c.x)} dy="14" fontSize={11} fill="#6c7a8c">{area.toFixed(1)} m²</tspan>
                </text>
              );
            })
          : null}
        {layers.dimensions
          ? doc.walls.map((w) => {
              const mid = { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 };
              const d = wallDirection(w);
              const off = (w.thicknessM / 2 + 14 / S) * 1;
              return (
                <text key={`d-${w.id}`} x={sx(mid.x - d.y * off)} y={sy(mid.y + d.x * off)} textAnchor="middle" fontSize={10.5} fill={selected.has(w.id) ? ACCENT : '#7b8797'} pointerEvents="none" fontFamily="ui-monospace, monospace">
                  {formatLength(wallLength(w), unit)}
                </text>
              );
            })
          : null}
        {chain && cursor ? (
          <text x={sx((chain.x + cursor.p.x) / 2)} y={sy((chain.y + cursor.p.y) / 2) - 8} textAnchor="middle" fontSize={12} fill={ACCENT} fontFamily="ui-monospace, monospace" pointerEvents="none">
            {formatLength(Math.hypot(cursor.p.x - chain.x, cursor.p.y - chain.y), unit)}
          </text>
        ) : null}
        {measureStart && cursor ? (
          <text x={sx((measureStart.x + cursor.p.x) / 2)} y={sy((measureStart.y + cursor.p.y) / 2) - 8} textAnchor="middle" fontSize={12} fill="#62c58b" fontFamily="ui-monospace, monospace" pointerEvents="none">
            {formatLength(Math.hypot(cursor.p.x - measureStart.x, cursor.p.y - measureStart.y), unit)}
          </text>
        ) : null}
        {measurements.map((m, i) => (
          <text key={i} data-testid="measurement" x={sx((m.a.x + m.b.x) / 2)} y={sy((m.a.y + m.b.y) / 2) - 8} textAnchor="middle" fontSize={12} fill="#62c58b" fontFamily="ui-monospace, monospace" pointerEvents="none">
            {formatLength(Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y), unit)}
          </text>
        ))}
      </svg>

      {doc.walls.length === 0 && doc.rooms.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-sm rounded-2xl border border-white/10 bg-black/40 px-6 py-5 text-center backdrop-blur">
            <p className="text-sm font-medium text-white">This plan is empty</p>
            <p className="mt-1 text-xs leading-relaxed text-white/60">Import a DXF drawing from the Import tab, or choose the Wall tool and click to draw walls.</p>
          </div>
        </div>
      ) : null}

      <div className="absolute right-3 top-3 z-20 flex flex-col gap-1 rounded-xl border border-white/10 bg-black/55 p-1 backdrop-blur-md">
        <IconButton label="Zoom in" onClick={() => setView((v) => ({ ...v, scale: Math.min(800, v.scale * 1.3) }))}>
          <Plus size={16} />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => setView((v) => ({ ...v, scale: Math.max(3, v.scale / 1.3) }))}>
          <Minus size={16} />
        </IconButton>
        <IconButton label="Fit plan to view" onClick={fit} data-testid="plan-fit">
          <Maximize size={16} />
        </IconButton>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-4 border-t border-white/10 bg-black/60 px-3 py-1.5 font-mono text-[11px] text-white/70 backdrop-blur-md" data-testid="plan-status">
        <span data-testid="plan-cursor">{cursorText}</span>
        <span>{S.toFixed(0)} px/m</span>
        <span className="text-white/40">snap: {snap.enabled ? (cursor?.kind ?? 'on') : 'off'}</span>
        {selWall ? <span className="text-[var(--bv-accent)]">{selWall.name}: {formatLength(wallLength(selWall), unit)}</span> : null}
        <span className="ml-auto hidden font-sans text-white/50 md:inline">{hint}</span>
      </div>
    </div>
  );
}

// Pure helpers so a drag always recomputes from the document at drag start (no accumulating error).
function moveWallPointFromBase(base: SceneDocument, id: string, which: 'start' | 'end', p: Pt) {
  return moveWallPoint(base, id, which, p, true);
}
function moveOpeningFromBase(base: SceneDocument, id: string, offsetM: number) {
  return moveOpening(base, id, offsetM);
}
function translateFromBase(base: SceneDocument, id: string, dx: number, dy: number) {
  return translateWall(base, id, dx, dy);
}
