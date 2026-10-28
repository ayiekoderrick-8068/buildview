import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BoxGeometry,
  CanvasTexture,
  MeshStandardMaterial,
  RepeatWrapping,
  type BufferGeometry,
  type Texture,
} from 'three';
import { useEditor } from '../state/editorStore.ts';
import { sceneRegistry } from './registry.ts';

let plasterBase: CanvasTexture | null = null;

/** Procedural, tileable noise used as a bump map for the "plaster" finish. Created once. */
function getPlasterBase(): CanvasTexture {
  if (plasterBase) return plasterBase;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(size, size);
    // Cheap value noise from a few octaves of a deterministic hash; wraps at the edges.
    const hash = (x: number, y: number) => {
      const xx = ((x % size) + size) % size;
      const yy = ((y % size) + size) % size;
      let n = (xx * 374761393 + yy * 668265263) | 0;
      n = ((n ^ (n >>> 13)) * 1274126177) | 0;
      return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0;
        let amp = 0.5;
        for (let o = 0; o < 3; o++) {
          const step = 1 << (o + 1);
          v += amp * hash(Math.floor(x / step) * step + o, Math.floor(y / step) * step - o);
          amp /= 2;
        }
        const c = Math.round(Math.min(1, v / 0.875) * 255);
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  plasterBase = new CanvasTexture(canvas);
  plasterBase.wrapS = plasterBase.wrapT = RepeatWrapping;
  return plasterBase;
}

/**
 * Box geometry whose UVs are in world metres, so a texture scale of 1 means one tile per metre on
 * every face regardless of the segment's size.
 */
export function createWorldUvBox([sx, sy, sz]: [number, number, number]): BufferGeometry {
  const geo = new BoxGeometry(sx, sy, sz);
  const uv = geo.getAttribute('uv');
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const faceScales: Array<[number, number]> = [
    [sz, sy],
    [sz, sy],
    [sx, sz],
    [sx, sz],
    [sx, sy],
    [sx, sy],
  ];
  faceScales.forEach(([su, sv], face) => {
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
    }
  });
  uv.needsUpdate = true;
  return geo;
}

/**
 * One independent MeshStandardMaterial per surface id, kept in sync with the document.
 * Because every surface owns its own instance, editing one wall can never affect another.
 */
export function useSurfaceMaterial(surfaceId: string): MeshStandardMaterial {
  const invalidate = useThree((s) => s.invalidate);
  const material = useMemo(() => new MeshStandardMaterial({ color: '#ffffff' }), []);
  const bump = useRef<Texture | null>(null);
  const spec = useEditor((s) => s.history.present.surfaces[surfaceId]);

  useEffect(() => {
    sceneRegistry.materials.set(surfaceId, material);
    return () => {
      sceneRegistry.materials.delete(surfaceId);
      bump.current?.dispose();
      bump.current = null;
      material.dispose();
    };
  }, [surfaceId, material]);

  useLayoutEffect(() => {
    if (!spec) return;
    material.color.set(spec.color);
    material.roughness = spec.roughness;
    material.metalness = spec.metalness;
    if (spec.finish === 'plaster') {
      if (!bump.current) {
        bump.current = getPlasterBase().clone();
        bump.current.wrapS = bump.current.wrapT = RepeatWrapping;
        bump.current.needsUpdate = true;
        material.bumpMap = bump.current;
        material.bumpScale = 1.5;
        material.needsUpdate = true;
      }
      bump.current.repeat.set(spec.textureScale, spec.textureScale);
    } else if (bump.current) {
      material.bumpMap = null;
      bump.current.dispose();
      bump.current = null;
      material.needsUpdate = true;
    }
    invalidate();
  }, [spec, material, invalidate]);

  return material;
}
