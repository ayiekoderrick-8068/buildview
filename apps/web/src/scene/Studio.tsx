import { Suspense, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { isTestMode } from '../debug.ts';
import { useEditor, type QualityLevel } from '../state/editorStore.ts';
import { CameraRig } from './CameraRig.tsx';
import { Furniture } from './Furniture.tsx';
import { Lighting } from './Lighting.tsx';
import { Room } from './Room.tsx';
import { sceneRegistry } from './registry.ts';

const DPR: Record<QualityLevel, number | [number, number]> = {
  high: [1, 2],
  balanced: [1, 1.5],
  low: 1,
};

/** Publishes live renderer handles for diagnostics and test hooks, and counts rendered frames. */
function SceneBridge() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    sceneRegistry.gl = gl;
    sceneRegistry.scene = scene;
    return () => {
      sceneRegistry.gl = null;
      sceneRegistry.scene = null;
    };
  }, [gl, scene]);
  useEffect(() => {
    sceneRegistry.camera = camera;
  }, [camera]);
  useFrame(() => {
    sceneRegistry.frameCount++;
  });
  return null;
}

export function Studio() {
  const quality = useEditor((s) => s.quality);
  const clearSelection = useEditor((s) => s.clearSelection);

  return (
    <Canvas
      // On-demand rendering: the scene only redraws when something changes, which keeps idle GPU use ~0.
      frameloop="demand"
      shadows={quality !== 'low'}
      dpr={DPR[quality]}
      gl={{ antialias: quality !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: isTestMode }}
      onPointerMissed={() => clearSelection()}
      data-testid="studio-canvas"
    >
      <Suspense fallback={null}>
        <SceneBridge />
        <CameraRig />
        <Lighting />
        <Room />
        <Furniture />
      </Suspense>
    </Canvas>
  );
}
