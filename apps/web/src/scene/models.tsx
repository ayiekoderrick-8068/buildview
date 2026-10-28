import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import type { FurnitureKind } from '@buildview/shared';
import { Part, useMaterials } from './primitives.tsx';

/**
 * Procedural furniture built from scaled primitives. Local frame: origin at the footprint centre on
 * the floor, front of the object faces +Z. Original geometry, no third-party assets.
 */

function Sofa() {
  const m = useMaterials({
    fabric: { color: '#6d7b8c', roughness: 0.95 },
    cushion: { color: '#7b8a9c', roughness: 0.95 },
    leg: { color: '#2a2018', roughness: 0.5 },
  });
  return (
    <group>
      {([-1, 1] as const).flatMap((sx) =>
        ([-1, 1] as const).map((sz) => (
          <Part key={`${sx}${sz}`} at={[sx * 1.0, 0.05, sz * 0.38]} size={[0.07, 0.1, 0.07]} material={m.leg} />
        )),
      )}
      <Part at={[0, 0.25, 0]} size={[1.8, 0.3, 0.95]} material={m.fabric} />
      {([-1, 1] as const).map((s) => (
        <Part key={s} at={[s * 1.0, 0.39, 0]} size={[0.2, 0.58, 0.95]} material={m.fabric} />
      ))}
      <Part at={[0, 0.63, -0.365]} size={[1.8, 0.46, 0.22]} material={m.fabric} />
      {[-0.6, 0, 0.6].map((x) => (
        <Part key={`s${x}`} at={[x, 0.46, 0.07]} size={[0.59, 0.12, 0.7]} material={m.cushion} />
      ))}
      {[-0.6, 0, 0.6].map((x) => (
        <Part key={`b${x}`} at={[x, 0.65, -0.2]} size={[0.58, 0.36, 0.16]} material={m.cushion} rotation={[-0.18, 0, 0]} />
      ))}
    </group>
  );
}

function CoffeeTable() {
  const m = useMaterials({
    wood: { color: '#7a5638', roughness: 0.55 },
    dark: { color: '#3b2a1c', roughness: 0.6 },
  });
  return (
    <group>
      <Part at={[0, 0.395, 0]} size={[1.1, 0.05, 0.6]} material={m.wood} />
      <Part at={[0, 0.13, 0]} size={[0.92, 0.03, 0.44]} material={m.dark} />
      {([-1, 1] as const).flatMap((sx) =>
        ([-1, 1] as const).map((sz) => (
          <Part key={`${sx}${sz}`} at={[sx * 0.5, 0.185, sz * 0.25]} size={[0.05, 0.37, 0.05]} material={m.dark} />
        )),
      )}
    </group>
  );
}

function Rug() {
  const m = useMaterials({
    base: { color: '#b8a58c', roughness: 1 },
    inner: { color: '#8e7e6a', roughness: 1 },
  });
  return (
    <group>
      <Part at={[0, 0.01, 0]} size={[3.0, 0.02, 2.0]} material={m.base} castShadow={false} />
      <Part at={[0, 0.021, 0]} size={[2.6, 0.004, 1.6]} material={m.inner} castShadow={false} />
    </group>
  );
}

function Armchair() {
  const m = useMaterials({
    fabric: { color: '#b4764a', roughness: 0.9 },
    leg: { color: '#2a2018', roughness: 0.5 },
  });
  return (
    <group>
      {([-1, 1] as const).flatMap((sx) =>
        ([-1, 1] as const).map((sz) => (
          <Part key={`${sx}${sz}`} at={[sx * 0.33, 0.05, sz * 0.33]} size={[0.06, 0.1, 0.06]} material={m.leg} />
        )),
      )}
      <Part at={[0, 0.27, 0.02]} size={[0.74, 0.34, 0.74]} material={m.fabric} />
      <Part at={[0, 0.58, -0.3]} size={[0.8, 0.56, 0.2]} material={m.fabric} rotation={[-0.1, 0, 0]} />
      {([-1, 1] as const).map((s) => (
        <Part key={s} at={[s * 0.38, 0.45, 0.03]} size={[0.12, 0.3, 0.72]} material={m.fabric} />
      ))}
      <Part at={[0, 0.48, 0.05]} size={[0.58, 0.1, 0.56]} material={m.fabric} />
    </group>
  );
}

function TvConsole() {
  const m = useMaterials({
    wood: { color: '#4b3626', roughness: 0.5 },
    door: { color: '#5a4230', roughness: 0.5 },
    tv: { color: '#07080a', roughness: 0.2, metalness: 0.4 },
    stand: { color: '#15171b', roughness: 0.5, metalness: 0.5 },
  });
  return (
    <group>
      <Part at={[0, 0.27, 0]} size={[1.6, 0.44, 0.4]} material={m.wood} />
      {[-0.4, 0.4].map((x) => (
        <Part key={x} at={[x, 0.27, 0.205]} size={[0.76, 0.38, 0.01]} material={m.door} />
      ))}
      {([-1, 1] as const).map((s) => (
        <Part key={s} at={[s * 0.72, 0.025, 0]} size={[0.05, 0.05, 0.3]} material={m.stand} />
      ))}
      <Part at={[0, 0.52, 0]} size={[0.3, 0.03, 0.2]} material={m.stand} />
      <Part at={[0, 0.76, 0]} size={[1.2, 0.46, 0.04]} material={m.tv} />
    </group>
  );
}

function Plant() {
  const m = useMaterials({
    pot: { color: '#b0603f', roughness: 0.8 },
    soil: { color: '#2b2118', roughness: 1 },
    leaf: { color: '#3f7a3d', roughness: 0.65 },
    leafDark: { color: '#2d5e2f', roughness: 0.7 },
  });
  const leaves = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2;
        const r = 0.12 + (i % 3) * 0.04;
        const h = 0.62 + (i % 4) * 0.14;
        return { a, x: Math.cos(a) * r, z: Math.sin(a) * r, y: h, tilt: 0.35 + (i % 3) * 0.12 };
      }),
    [],
  );
  return (
    <group>
      <Part at={[0, 0.2, 0]} size={[0.2, 0.4, 0.2]} shape="cylinder" material={m.pot} />
      <Part at={[0, 0.39, 0]} size={[0.19, 0.02, 0.19]} shape="cylinder" material={m.soil} />
      {leaves.map((l, i) => (
        <group key={i} position={[l.x, l.y, l.z]} rotation={[0, -l.a, 0]}>
          <Part at={[0.05, 0, 0]} size={[0.06, 0.26, 0.1]} shape="sphere" material={i % 2 ? m.leaf : m.leafDark} rotation={[0, 0, -l.tilt]} />
        </group>
      ))}
      <Part at={[0, 0.78, 0]} size={[0.015, 0.78, 0.015]} shape="cylinder" material={m.leafDark} />
    </group>
  );
}

function useArtTexture() {
  const texture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 171;
    const ctx = c.getContext('2d');
    if (ctx) {
      const g = ctx.createLinearGradient(0, 0, 256, 171);
      g.addColorStop(0, '#e9d8bd');
      g.addColorStop(1, '#c98f6b');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 171);
      ctx.fillStyle = '#2f4858';
      ctx.beginPath();
      ctx.arc(90, 90, 48, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d9ae62';
      ctx.beginPath();
      ctx.arc(160, 70, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7a9a7e';
      ctx.fillRect(40, 130, 180, 14);
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function WallArt() {
  const art = useArtTexture();
  const m = useMaterials({ frame: { color: '#1b1b1d', roughness: 0.4 } });
  const canvasMat = useMemo(() => ({ map: art, roughness: 0.8 }), [art]);
  return (
    <group>
      <Part at={[0, 0, 0]} size={[1.2, 0.8, 0.04]} material={m.frame} />
      <mesh position={[0, 0, 0.0215]} receiveShadow>
        <planeGeometry args={[1.1, 0.7]} />
        <meshStandardMaterial {...canvasMat} />
      </mesh>
    </group>
  );
}

export const FURNITURE_MODELS: Record<FurnitureKind, () => React.JSX.Element> = {
  sofa: Sofa,
  'coffee-table': CoffeeTable,
  rug: Rug,
  armchair: Armchair,
  'tv-console': TvConsole,
  plant: Plant,
  'wall-art': WallArt,
};
