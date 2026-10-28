import { useEffect, useState } from 'react';
import {
  BoxGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  SphereGeometry,
  type Material,
  type MeshStandardMaterialParameters,
} from 'three';

/**
 * Shared unit geometries: every furniture part is a scaled instance of one of these, so the whole
 * studio uploads three small geometries instead of hundreds. They live for the app's lifetime.
 */
const UNIT_BOX = new BoxGeometry(1, 1, 1);
const UNIT_CYLINDER = new CylinderGeometry(1, 1, 1, 28);
const UNIT_SPHERE = new SphereGeometry(1, 20, 14);

type V3 = [number, number, number];

export interface PartProps {
  /** Centre position. */
  at: V3;
  /** Box: full size. Cylinder: [radius, height, radius]. Sphere: radii. */
  size: V3;
  material: Material;
  shape?: 'box' | 'cylinder' | 'sphere';
  rotation?: V3;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export function Part({ at, size, material, shape = 'box', rotation, castShadow = true, receiveShadow = true }: PartProps) {
  const geometry = shape === 'box' ? UNIT_BOX : shape === 'cylinder' ? UNIT_CYLINDER : UNIT_SPHERE;
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={at}
      scale={size}
      rotation={rotation}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
}

/** Creates a set of named materials once per component and disposes them on unmount. */
export function useMaterials<K extends string>(defs: Record<K, MeshStandardMaterialParameters>): Record<K, MeshStandardMaterial> {
  // Definitions are static per model, so build once.
  const [mats] = useState(() => {
    const out = {} as Record<K, MeshStandardMaterial>;
    for (const key of Object.keys(defs) as K[]) out[key] = new MeshStandardMaterial(defs[key]);
    return out;
  });
  useEffect(
    () => () => {
      for (const m of Object.values<MeshStandardMaterial>(mats)) m.dispose();
    },
    [mats],
  );
  return mats;
}
