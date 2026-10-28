import { useLayoutEffect, useMemo, useRef } from 'react';
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { MathUtils, OrthographicCamera as ThreeOrtho, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useEditor } from '../state/editorStore.ts';
import { buildingBounds } from './buildingInfo.ts';

type Pose = { position: Vector3; target: Vector3; zoom: number };

const TOP_HEIGHT = 40;
const TWEEN_MS = 480;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Owns the active camera (perspective for 3D, orthographic for the top-down view) and the orbit
 * controls. Poses are derived from the building bounds so any imported plan frames correctly.
 * Reset/fit commands animate smoothly; everything else is damped orbit/zoom/pan.
 */
export function CameraRig() {
  const viewMode = useEditor((s) => s.viewMode);
  const command = useEditor((s) => s.cameraCommand);
  const dragging = useEditor((s) => s.dragging);
  const walls = useEditor((s) => s.history.present.walls);
  const rooms = useEditor((s) => s.history.present.rooms);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const tween = useRef<{ start: number; from: Pose; to: Pose } | null>(null);
  const lastCamera = useRef<unknown>(null);
  const lastNonce = useRef<number | null>(null);
  const b = useMemo(() => buildingBounds({ walls, rooms }), [walls, rooms]);
  const bRef = useRef(b);
  bRef.current = b;

  const poseFor = (type: 'reset' | 'fit'): Pose => {
    const bb = bRef.current;
    const cx = bb.center.x;
    const cz = -bb.center.y;
    if (viewMode === '2d') {
      const zoom = Math.max(8, Math.min(size.width / (bb.width + 2), size.height / (bb.depth + 2)));
      return { position: new Vector3(cx, TOP_HEIGHT, cz), target: new Vector3(cx, 0, cz), zoom };
    }
    const r = bb.radius;
    const small = rooms.length === 1 && bb.width < 7 && bb.depth < 6;
    if (type === 'reset' && small) {
      // single small room: stand in its south-west corner looking across it
      return {
        position: new Vector3(cx - bb.width * 0.39, 1.5, cz + bb.depth * 0.44),
        target: new Vector3(cx + bb.width * 0.2, 0.85, cz - bb.depth * 0.17),
        zoom: 1,
      };
    }
    return { position: new Vector3(cx + r * 1.25, r * 1.1 + 1.5, cz + r * 1.3), target: new Vector3(cx, 1, cz), zoom: 1 };
  };

  useLayoutEffect(() => {
    const ctl = controls.current;
    if (!ctl) return;
    const nonce = command?.nonce ?? null;
    const cameraChanged = lastCamera.current !== camera;
    const isNew = cameraChanged || nonce !== lastNonce.current;
    lastNonce.current = nonce;
    lastCamera.current = camera;
    if (!isNew) return;
    const to = poseFor(command?.type ?? 'reset');
    if (cameraChanged || viewMode === '2d') {
      camera.position.copy(to.position);
      ctl.target.copy(to.target);
      if (camera instanceof ThreeOrtho) {
        camera.zoom = to.zoom;
        camera.updateProjectionMatrix();
      }
      camera.lookAt(to.target);
      ctl.update();
      invalidate();
      return;
    }
    tween.current = { start: performance.now(), from: { position: camera.position.clone(), target: ctl.target.clone(), zoom: 1 }, to };
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, camera, viewMode, size.width, size.height]);

  useFrame(() => {
    const ctl = controls.current;
    if (!ctl) return;
    const t = tween.current;
    if (t) {
      const k = ease(MathUtils.clamp((performance.now() - t.start) / TWEEN_MS, 0, 1));
      camera.position.lerpVectors(t.from.position, t.to.position, k);
      ctl.target.lerpVectors(t.from.target, t.to.target, k);
      ctl.update();
      if (k >= 1) tween.current = null;
      invalidate();
    }
    // Keep the pivot inside a sensible area so panning cannot lose the building.
    const bb = bRef.current;
    const lim = bb.radius * 2 + 4;
    ctl.target.x = MathUtils.clamp(ctl.target.x, bb.center.x - lim, bb.center.x + lim);
    ctl.target.z = MathUtils.clamp(ctl.target.z, -bb.center.y - lim, -bb.center.y + lim);
    ctl.target.y = MathUtils.clamp(ctl.target.y, 0, 4);
  });

  const is2d = viewMode === '2d';
  return (
    <>
      {is2d ? (
        <OrthographicCamera key="ortho" makeDefault position={[0, TOP_HEIGHT, 0]} up={[0, 0, -1]} near={0.1} far={120} zoom={30} />
      ) : (
        <PerspectiveCamera key="persp" makeDefault fov={58} near={0.05} far={300} position={[-1.95, 1.5, 1.75]} />
      )}
      <OrbitControls
        key={viewMode}
        ref={controls}
        makeDefault
        enabled={!dragging}
        enableDamping
        dampingFactor={0.1}
        rotateSpeed={0.7}
        zoomSpeed={0.9}
        panSpeed={0.9}
        screenSpacePanning
        enableRotate={!is2d}
        minDistance={0.5}
        maxDistance={is2d ? 200 : Math.max(18, b.radius * 5)}
        minPolarAngle={0.05}
        maxPolarAngle={Math.PI * 0.495}
        minZoom={4}
        maxZoom={400}
      />
    </>
  );
}
