import { describe, expect, it } from 'vitest';
import { PAINT_PRESETS, SaveProjectRequestSchema, SurfaceMaterialSchema } from '../src/index.ts';

describe('schemas', () => {
  it('provides the nine required paint presets with valid colours', () => {
    expect(PAINT_PRESETS.map((p) => p.name)).toEqual([
      'White Dove', 'Sand Beige', 'Sage Green', 'Sky Blue', 'Terracotta Red',
      'Charcoal', 'Warm Grey', 'Olive', 'Navy Blue',
    ]);
    for (const p of PAINT_PRESETS) {
      expect(SurfaceMaterialSchema.safeParse({ color: p.color, finish: 'matte', roughness: 1, metalness: 0, textureScale: 1 }).success).toBe(true);
    }
  });

  it('rejects malformed colours and out-of-range values', () => {
    const base = { finish: 'matte', roughness: 0.5, metalness: 0, textureScale: 1 };
    expect(SurfaceMaterialSchema.safeParse({ ...base, color: 'red' }).success).toBe(false);
    expect(SurfaceMaterialSchema.safeParse({ ...base, color: '#12345' }).success).toBe(false);
    expect(SurfaceMaterialSchema.safeParse({ ...base, color: '#123456', roughness: 2 }).success).toBe(false);
  });

  it('requires a base revision and a document on save requests', () => {
    expect(SaveProjectRequestSchema.safeParse({}).success).toBe(false);
  });
});
