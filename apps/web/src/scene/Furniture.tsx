import { memo, useEffect, useMemo } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { BoxGeometry, EdgesGeometry, LineBasicMaterial, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { useEditor } from '../state/editorStore.ts';
import { FURNITURE_MODELS } from './models.tsx';

const ACCENT = '#f0c070';
const noRaycast = () => null;
const FLOOR = new Plane(new Vector3(0, 1, 0), 0);
const DRAG_THRESHOLD_PX = 4;

/** Pointer-down bookkeeping shared between an object and the DragController. */
const pending: {
  id: string | null;
  startX: number;
  startY: number;
  offset: [number, number];
  active: boolean;
} = { id: null, startX: 0, startY: 0, offset: [0, 0], active: false };

const FurnitureObject = memo(function FurnitureObject({ id }: { id: string }) {
  const item = useEditor((s) => s.history.present.furniture.find((f) => f.id === id));
  const selected = useEditor((s) => s.selection?.kind === 'furniture' && s.selection.ids.includes(id));
  const invalidate = useThree((s) => s.invalidate);

  const size = item?.size;
  const outline = useMemo(() => {
    if (!size) return null;
    const box = new BoxGeometry(size[0] + 0.04, size[1] + 0.04, size[2] + 0.04);
    const edges = new EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [size]);
  const lineMaterial = useMemo(() => new LineBasicMaterial({ color: ACCENT }), []);
  useEffect(() => () => outline?.dispose(), [outline]);
  useEffect(() => () => lineMaterial.dispose(), [lineMaterial]);
  useEffect(() => invalidate(), [item, selected, invalidate]);

  if (!item || item.deleted || !outline) return null;
  const Model = FURNITURE_MODELS[item.kind];
  // Wall art models are centred on their own origin; everything else sits on the floor.
  const y = item.kind === 'wall-art' ? item.elevation + item.size[1] / 2 : item.elevation;

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const store = useEditor.getState();
    store.selectFurniture(id);
    if (!item.movable) return;
    const hit = e.ray.intersectPlane(FLOOR, new Vector3());
    pending.id = id;
    pending.startX = e.nativeEvent.clientX;
    pending.startY = e.nativeEvent.clientY;
    pending.active = false;
    pending.offset = hit ? [item.position[0] - hit.x, item.position[1] - hit.z] : [0, 0];
  };

  return (
    <group
      name={id}
      position={[item.position[0], y, item.position[1]]}
      rotation={[0, item.rotationY, 0]}
      onPointerDown={onPointerDown}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = item.movable ? 'grab' : 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
    >
      <Model />
      {selected ? (
        <lineSegments
          geometry={outline}
          material={lineMaterial}
          position={[0, item.kind === 'wall-art' ? 0 : item.size[1] / 2, 0]}
          raycast={noRaycast}
          renderOrder={3}
        />
      ) : null}
    </group>
  );
});

/**
 * Converts window pointer events into floor-constrained furniture drags. Live moves update the
 * document without history; the whole drag becomes one undo step when the pointer is released.
 */
function DragController() {
  const { camera, gl, invalidate } = useThree();
  const raycaster = useMemo(() => new Raycaster(), []);

  useEffect(() => {
    const ndc = new Vector2();
    const point = new Vector3();
    const canvas = gl.domElement;

    const onMove = (e: PointerEvent) => {
      if (!pending.id) return;
      if (!pending.active) {
        if (Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) < DRAG_THRESHOLD_PX) return;
        pending.active = true;
        useEditor.getState().beginDrag();
        document.body.style.cursor = 'grabbing';
      }
      const rect = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(FLOOR, point)) return;
      useEditor.getState().dragFurnitureTo(pending.id, [point.x + pending.offset[0], point.z + pending.offset[1]]);
      invalidate();
    };
    const onUp = () => {
      if (pending.active) {
        useEditor.getState().endDrag();
        document.body.style.cursor = '';
      }
      pending.id = null;
      pending.active = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [camera, gl, invalidate, raycaster]);

  return null;
}

export function Furniture() {
  const ids = useEditor((s) => s.history.present.furniture.map((f) => f.id).join('|'));
  return (
    <group name="furniture">
      {ids.split('|').map((id) => (
        <FurnitureObject key={id} id={id} />
      ))}
      <DragController />
    </group>
  );
}
