import type { FinishType, SurfaceMaterial } from './schema.ts';

export interface PaintPreset {
  id: string;
  name: string;
  color: string;
}

export const PAINT_PRESETS: readonly PaintPreset[] = [
  { id: 'white-dove', name: 'White Dove', color: '#F1EEE6' },
  { id: 'sand-beige', name: 'Sand Beige', color: '#D8C3A0' },
  { id: 'sage-green', name: 'Sage Green', color: '#9CAF88' },
  { id: 'sky-blue', name: 'Sky Blue', color: '#87B4D8' },
  { id: 'terracotta-red', name: 'Terracotta Red', color: '#C4553B' },
  { id: 'charcoal', name: 'Charcoal', color: '#3A3D42' },
  { id: 'warm-grey', name: 'Warm Grey', color: '#A39E97' },
  { id: 'olive', name: 'Olive', color: '#6B6B2F' },
  { id: 'navy-blue', name: 'Navy Blue', color: '#1F2F54' },
];

export interface FinishPreset {
  type: FinishType;
  label: string;
  roughness: number;
  metalness: number;
  textured: boolean;
  /** Whether the metalness control applies to this finish. */
  metalnessAdjustable: boolean;
  description: string;
}

export const FINISH_PRESETS: Record<FinishType, FinishPreset> = {
  matte: { type: 'matte', label: 'Matte', roughness: 0.95, metalness: 0, textured: false, metalnessAdjustable: false, description: 'Flat, non-reflective paint.' },
  eggshell: { type: 'eggshell', label: 'Eggshell', roughness: 0.7, metalness: 0, textured: false, metalnessAdjustable: false, description: 'Soft low sheen.' },
  satin: { type: 'satin', label: 'Satin', roughness: 0.45, metalness: 0, textured: false, metalnessAdjustable: false, description: 'Smooth, moderate sheen.' },
  gloss: { type: 'gloss', label: 'Gloss', roughness: 0.15, metalness: 0, textured: false, metalnessAdjustable: false, description: 'High-shine, highly reflective.' },
  metallic: { type: 'metallic', label: 'Metallic', roughness: 0.35, metalness: 0.7, textured: false, metalnessAdjustable: true, description: 'Paint with metallic pigment.' },
  plaster: { type: 'plaster', label: 'Plaster', roughness: 0.9, metalness: 0, textured: true, metalnessAdjustable: false, description: 'Textured plaster; texture scale applies.' },
};

export function materialFromFinish(color: string, finish: FinishType): SurfaceMaterial {
  const preset = FINISH_PRESETS[finish];
  return {
    color,
    finish,
    roughness: preset.roughness,
    metalness: preset.metalness,
    textureScale: 1,
  };
}
