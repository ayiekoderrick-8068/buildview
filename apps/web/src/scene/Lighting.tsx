import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Color } from 'three';
import { polygonArea } from '@buildview/geometry-engine';
import { useEditor } from '../state/editorStore.ts';
import { buildingBounds, roomLightPoints } from './buildingInfo.ts';

/**
 * Physically plausible, inexpensive lighting: one shadow-casting directional light, a hemisphere
 * fill, and a few un-shadowed interior point lights above the largest rooms. Presets only change
 * colours/positions; the ambient and sun sliders scale intensity.
 */
const PRESETS = {
  daylight: {
    background: '#bcd8f0',
    sunColor: '#fff2dc',
    sunIntensity: 3.2,
    sunDir: [-0.25, 0.6, 0.75] as [number, number, number],
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
    sunDir: [-0.7, 0.16, 0.7] as [number, number, number],
    skyColor: '#5b4a78',
    groundColor: '#2e2430',
    hemiIntensity: 0.28,
    interiorIntensity: 9,
    interiorColor: '#ffb870',
  },
};

const SHADOW_SIZE = { high: 2048, balanced: 1024, low: 512 } as const;
const MAX_POINT_LIGHTS = 6;

export function Lighting() {
  const lighting = useEditor((s) => s.history.present.lighting);
  const rooms = useEditor((s) => s.history.present.rooms);
  const walls = useEditor((s) => s.history.present.walls);
  const levels = useEditor((s) => s.history.present.levels);
  const quality = useEditor((s) => s.quality);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const p = PRESETS[lighting.preset];
  const background = useMemo(() => new Color(p.background), [p.background]);
  const bounds = useMemo(() => buildingBounds({ walls, rooms }), [walls, rooms]);
  const lightH = (levels[0]?.heightM ?? 2.8) - 0.25;

  const points = useMemo(
    () =>
      [...rooms]
        .sort((a, b) => Math.abs(polygonArea(b.polygon)) - Math.abs(polygonArea(a.polygon)))
        .flatMap((r) => roomLightPoints(r).slice(0, 2))
        .slice(0, MAX_POINT_LIGHTS),
    [rooms],
  );

  useEffect(() => {
    scene.background = background;
    invalidate();
  }, [scene, background, invalidate]);

  const reach = Math.max(6, bounds.radius * 1.4);
  // Plan north (+y) is world -Z; the light shines from the given direction towards the origin (plans are centred there).
  const sunPos: [number, number, number] = [p.sunDir[0] * reach * 2.2, p.sunDir[1] * reach * 2.2, -p.sunDir[2] * reach * 2.2];
  return (
    <>
      <hemisphereLight args={[p.skyColor, p.groundColor, p.hemiIntensity * lighting.ambient]} />
      <directionalLight
        color={p.sunColor}
        intensity={p.sunIntensity * lighting.sun}
        position={sunPos}
        castShadow={quality !== 'low'}
        shadow-mapSize={[SHADOW_SIZE[quality], SHADOW_SIZE[quality]]}
        shadow-camera-left={-reach}
        shadow-camera-right={reach}
        shadow-camera-top={reach}
        shadow-camera-bottom={-reach}
        shadow-camera-near={0.5}
        shadow-camera-far={reach * 6}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      {lighting.interior
        ? points.map((pt, i) => <pointLight key={i} position={[pt.x, lightH, -pt.y]} color={p.interiorColor} intensity={p.interiorIntensity * 2.5} distance={9} decay={2} />)
        : null}
    </>
  );
}
