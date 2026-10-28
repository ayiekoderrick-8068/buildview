import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Color } from 'three';
import { useEditor } from '../state/editorStore.ts';

/**
 * Physically plausible, inexpensive lighting: one shadow-casting directional light, a hemisphere
 * fill, and two un-shadowed interior point lights. Presets only change colours/positions; the
 * ambient and sun sliders scale intensity.
 */
const PRESETS = {
  daylight: {
    background: '#bcd8f0',
    sunColor: '#fff2dc',
    sunIntensity: 3.2,
    sunPosition: [-2.5, 5.5, -9] as [number, number, number],
    skyColor: '#d6e8ff',
    groundColor: '#9c8f7d',
    hemiIntensity: 0.85,
    interiorIntensity: 3.5,
    interiorColor: '#ffe2b8',
  },
  evening: {
    background: '#241c33',
    sunColor: '#ff8f4d',
    sunIntensity: 1.3,
    sunPosition: [-7, 1.6, -7] as [number, number, number],
    skyColor: '#5b4a78',
    groundColor: '#2e2430',
    hemiIntensity: 0.28,
    interiorIntensity: 9,
    interiorColor: '#ffb870',
  },
};

const SHADOW_SIZE = { high: 2048, balanced: 1024, low: 512 } as const;

export function Lighting() {
  const lighting = useEditor((s) => s.history.present.lighting);
  const quality = useEditor((s) => s.quality);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const p = PRESETS[lighting.preset];
  const background = useMemo(() => new Color(p.background), [p.background]);

  useEffect(() => {
    scene.background = background;
    invalidate();
  }, [scene, background, invalidate]);

  return (
    <>
      <hemisphereLight args={[p.skyColor, p.groundColor, p.hemiIntensity * lighting.ambient]} />
      <directionalLight
        color={p.sunColor}
        intensity={p.sunIntensity * lighting.sun}
        position={p.sunPosition}
        castShadow={quality !== 'low'}
        shadow-mapSize={[SHADOW_SIZE[quality], SHADOW_SIZE[quality]]}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-camera-near={0.5}
        shadow-camera-far={25}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      {lighting.interior ? (
        <>
          <pointLight position={[-1.2, 2.55, 0]} color={p.interiorColor} intensity={p.interiorIntensity * 2.5} distance={9} decay={2} />
          <pointLight position={[1.2, 2.55, 0]} color={p.interiorColor} intensity={p.interiorIntensity * 2.5} distance={9} decay={2} />
        </>
      ) : null}
    </>
  );
}
