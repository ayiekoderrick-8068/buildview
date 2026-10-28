import { useLayoutEffect, useRef } from 'react';
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { MathUtils, OrthographicCamera as ThreeOrtho, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useEditor } from '../state/editorStore.ts';

type Pose = { position: Vector3; target: Vector3; zoom: number };

const INTERIOR_POSE = { position: new Vector3(-1.95, 1.5, 1.75), target: new Vector3(1.0, 0.85, -0.7) };
const OVERVIEW_POSE = { position: new Vector3(6.4, 5.6, 6.6), target: new Vector3(0, 0.9, 0) };
const TOP_HEIGHT = 14;
const TWEEN_MS = 480;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Owns the active camera (perspective for 3D, orthographic for the 2D plan view) and the orbit
 * controls. Reset/fit commands animate smoothly; everything else is damped orbit/zoom/pan.
 */
export function CameraRig() {
  const viewMode = useEditor((s) => s.viewMode);
  const command = useEditor((s) => s.cameraCommand);
  const dragging = useEditor((s) => s.dragging);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const tween = useRef<{ start: number; from: Pose; to: Pose } | null>(null);
  const lastCamera = useRef<unknown>(null);
  const lastNonce = useRef<number | null>(null);

  const poseFor = (type: 'reset' | 'fit'): Pose => {
    if (viewMode === '2d') {
      const zoom = Math.max(20, Math.min(size.width / 6.8, size.height / 5.6));
      return { position: new Vector3(0, TOP_HEIGHT, 0), target: new Vector3(0, 0, 0), zoom };
    }
    const base = type === 'fit' ? OVERVIEW_POSE : INTERIOR_POSE;
    return { position: base.position.clone(), target: base.target.clone(), zoom: 1 };
  };

  useLayoutEffect(() => {
    const ctl = controls.current;
    if (!ctl) return;
    const nonce = command?.nonce ?? null;
    // A new camera (view mode switch) or a new command both mean "go to this pose".
    const cameraChanged = lastCamera.current !== camera;
    const isNew = cameraChanged || nonce !== lastNonce.current;
    lastNonce.current = nonce;
    lastCamera.current = camera;
    if (!isNew) return;
    const to = poseFor(command?.type ?? 'reset');
    if (cameraChanged || viewMode === '2d') {
      // Snap on startup and whenever the active camera changes (the projection differs, so tweening is meaningless).
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
    tween.current = {
      start: performance.now(),
      from: { position: camera.position.clone(), target: ctl.target.clone(), zoom: 1 },
      to,
    };
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
    // Keep the pivot inside a sensible area so panning cannot lose the room.
    ctl.target.x = MathUtils.clamp(ctl.target.x, -7, 7);
    ctl.target.z = MathUtils.clamp(ctl.target.z, -7, 7);
    ctl.target.y = MathUtils.clamp(ctl.target.y, 0, 3.5);
  });

  const is2d = viewMode === '2d';
  return (
    <>
      {is2d ? (
        <OrthographicCamera key="ortho" makeDefault position={[0, TOP_HEIGHT, 0]} up={[0, 0, -1]} near={0.1} far={60} zoom={60} />
      ) : (
        <PerspectiveCamera key="persp" makeDefault fov={58} near={0.05} far={120} position={INTERIOR_POSE.position.toArray()} />
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
        maxDistance={18}
        minPolarAngle={0.05}
        maxPolarAngle={Math.PI * 0.495}
        minZoom={20}
        maxZoom={400}
      />
    </>
  );
}
