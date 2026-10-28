import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CadParseResultSchema, SceneDocumentSchema, type CadParseResult, type SceneDocument } from '@buildview/shared';
import {
  DEFAULT_RECOGNITION,
  analyzeTopology,
  hasBlockingIssues,
  polygonArea,
  recognizeBuilding,
  suggestLayerMap,
  validateDocument,
  wallLength,
  type RecognitionOptions,
} from '../src/index.ts';

const parsed = (name: string): CadParseResult =>
  CadParseResultSchema.parse(JSON.parse(readFileSync(new URL(`../../../tests/fixtures/parsed/${name}.json`, import.meta.url), 'utf8')));

function recognize(name: string, over: Partial<RecognitionOptions> = {}) {
  const cad = parsed(name);
  const opts: RecognitionOptions = {
    ...DEFAULT_RECOGNITION,
    toMetres: cad.units.toMetres ?? 0.001,
    layerMap: suggestLayerMap(cad.layers.map((l) => l.name)),
    ...over,
  };
  return recognizeBuilding(cad, opts);
}

const toDoc = (r: ReturnType<typeof recognize>): SceneDocument => ({
  schemaVersion: 2,
  ...r.parts,
  roof: null,
  surfaces: {},
  furniture: [],
  lighting: { preset: 'daylight', ambient: 1, sun: 1, interior: true },
  sources: [],
  acknowledgedIssues: [],
  approval: { status: 'draft', approvedAt: null },
});

describe('layer mapping suggestions', () => {
  it('maps conventional layer names and ignores the rest', () => {
    expect(suggestLayerMap(['A-WALL', 'A-DOOR', 'A-GLAZ', 'A-ANNO', 'A-ROOM', 'Defpoints'])).toEqual({
      'A-WALL': 'wall', 'A-DOOR': 'door', 'A-GLAZ': 'window', 'A-ANNO': 'ignore', 'A-ROOM': 'room', Defpoints: 'ignore',
    });
  });
});

describe('house-mm reference drawing', () => {
  const r = recognize('house-mm');

  it('recognises six walls with exact metric lengths', () => {
    expect(r.parts.walls).toHaveLength(6);
    const lengths = r.parts.walls.map(wallLength).sort((a, b) => a - b);
    expect(lengths[0]).toBeCloseTo(4); // partition x=5000..9000
    expect(lengths.filter((l) => Math.abs(l - 9) < 1e-6)).toHaveLength(2);
    expect(lengths.filter((l) => Math.abs(l - 7) < 1e-6)).toHaveLength(3); // east wall, west wall, partition
    expect(r.parts.walls.every((w) => w.thicknessM === 0.2 && w.heightM === 2.8)).toBe(true);
  });

  it('keeps source handles for traceability and uses deterministic ids', () => {
    expect(r.parts.walls.map((w) => w.id)).toEqual(['WALL-001', 'WALL-002', 'WALL-003', 'WALL-004', 'WALL-005', 'WALL-006']);
    expect(r.parts.walls.every((w) => w.sourceHandles.length > 0)).toBe(true);
    expect(JSON.stringify(recognize('house-mm').parts)).toBe(JSON.stringify(r.parts)); // deterministic
  });

  it('centres the plan on the origin and records the shift', () => {
    expect(r.originM).toEqual({ x: 4.5, y: 3.5 });
    const xs = r.parts.walls.flatMap((w) => [w.start.x, w.end.x]);
    expect(Math.min(...xs)).toBeCloseTo(-4.5);
    expect(Math.max(...xs)).toBeCloseTo(4.5);
  });

  it('places two doors and two windows with measured widths, on the right walls', () => {
    expect(r.parts.openings.filter((o) => o.kind === 'door').map((o) => o.widthM)).toEqual([0.9, 0.9]);
    expect(r.parts.openings.filter((o) => o.kind === 'window').map((o) => o.widthM)).toEqual([1.5, 1.5]);
    const wall = (id: string) => r.parts.walls.find((w) => w.id === id)!;
    for (const o of r.parts.openings) {
      const w = wall(o.wallId);
      expect(o.offsetM - o.widthM / 2).toBeGreaterThanOrEqual(-1e-9);
      expect(o.offsetM + o.widthM / 2).toBeLessThanOrEqual(wallLength(w) + 1e-9);
      expect(o.notes[0]).toMatch(/defaults/);
    }
    // south door: hinge at x=2000 mm, swing to 2900 mm -> centre x = 2.45 m from the drawing origin
    const south = r.parts.openings.find((o) => Math.abs(wall(o.wallId).start.y - -3.5) < 1e-6 && Math.abs(wall(o.wallId).end.y - -3.5) < 1e-6)!;
    const w = wall(south.wallId);
    const dirX = Math.sign(w.end.x - w.start.x);
    expect(w.start.x + dirX * south.offsetM).toBeCloseTo(2.45 - 4.5);
  });

  it('detects the three rooms with interior areas inset by half the wall thickness', () => {
    const areas = r.parts.rooms.map((room) => polygonArea(room.polygon)).sort((a, b) => a - b);
    expect(areas).toHaveLength(3);
    expect(areas[0]).toBeCloseTo(3.8 * 3.3);
    expect(areas[1]).toBeCloseTo(3.8 * 3.3);
    expect(areas[2]).toBeCloseTo(4.8 * 6.8);
  });

  it('reports unsupported entities instead of dropping them silently', () => {
    const codes = r.issues.map((i) => `${i.code}:${i.severity}`);
    expect(codes).toContain('unsupported-entity:warning'); // SPLINE
    expect(codes).toContain('unsupported-entity:info'); // TEXT
    expect(codes).toContain('thickness-assumed:info');
    expect(r.issues.find((i) => i.message.includes('SPLINE'))?.sourceHandles.length).toBeGreaterThan(0);
  });

  it('produces a schema-valid document with no blocking issues', () => {
    const doc = toDoc(r);
    expect(SceneDocumentSchema.safeParse(doc).success).toBe(true);
    expect(hasBlockingIssues(validateDocument(doc))).toBe(false);
  });
});

describe('units', () => {
  it('feet drawing converts to the same metric plan as the mm drawing', () => {
    const mm = recognize('house-mm');
    const ft = recognize('house-feet');
    expect(ft.parts.walls.map(wallLength).map((l) => Math.round(l * 100))).toEqual(mm.parts.walls.map(wallLength).map((l) => Math.round(l * 100)));
  });

  it('the parser reports missing units as unknown scale (user must choose)', () => {
    const cad = parsed('house-missing-units');
    expect(cad.units.toMetres).toBeNull();
    const confirmed = recognize('house-missing-units', { toMetres: 0.001 });
    expect(confirmed.parts.walls).toHaveLength(6);
    const wrong = recognize('house-missing-units', { toMetres: 1 }); // wrong confirmation = 1000x larger, not silently "fixed"
    expect(Math.max(...wrong.parts.walls.map(wallLength))).toBeCloseTo(9000);
  });
});

describe('double-line walls', () => {
  it('pairs parallel lines into centreline walls with measured thickness and closes corners', () => {
    const r = recognize('house-double-line', { wallMode: 'double-line' });
    expect(r.parts.walls).toHaveLength(4);
    for (const w of r.parts.walls) expect(w.thicknessM).toBeCloseTo(0.2);
    const room = r.parts.rooms[0]!;
    expect(polygonArea(room.polygon)).toBeCloseTo(5.8 * 3.8);
    expect(r.issues.some((i) => i.code === 'gaps-closed')).toBe(true);
  });
});

describe('gaps, duplicates and stubs', () => {
  it('merges the duplicate line and does not silently close a 30 mm gap beyond the tolerance', () => {
    const r = recognize('gaps-duplicates');
    expect(r.stats.duplicatesRemoved).toBe(1);
    expect(r.stats.gapsClosed).toBe(0);
    const issues = validateDocument(toDoc(r));
    expect(issues.some((i) => i.code === 'wall-gap' && i.severity === 'critical')).toBe(true);
  });

  it('closes the 30 mm gap when the tolerance allows it, and flags the edited wall for review', () => {
    const r = recognize('gaps-duplicates', { closeGapM: 0.05 });
    expect(r.stats.gapsClosed).toBe(1);
    expect(r.parts.walls.some((w) => w.verificationStatus === 'needs-review' && w.notes.some((n) => /30 mm/.test(n)))).toBe(true);
    expect(r.issues.find((i) => i.code === 'gaps-closed')?.message).toMatch(/30 mm/);
  });

  it('still reports the 300 mm gap as a critical room-boundary break and a free stub end', () => {
    const issues = validateDocument(toDoc(recognize('gaps-duplicates', { closeGapM: 0.05 })));
    const gap = issues.find((i) => i.code === 'wall-gap')!;
    expect(gap.message).toMatch(/300 mm/);
    expect(gap.suggestion).toBeTruthy();
    expect(gap.sourceHandles.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.code === 'wall-free-end' && i.severity === 'warning')).toBe(true);
    expect(hasBlockingIssues(issues)).toBe(true);
  });
});

describe('curves and blocks', () => {
  it('approximates bulged polylines and arcs by segments and flags them for review', () => {
    const r = recognize('arcs-bulges');
    expect(r.parts.walls.length).toBeGreaterThan(6);
    expect(r.parts.walls.some((w) => w.verificationStatus === 'needs-review' && w.notes.some((n) => /Curved/.test(n)))).toBe(true);
  });

  it('nested blocks yield a single opening', () => {
    const r = recognize('nested-block');
    expect(r.parts.openings).toHaveLength(1);
    expect(r.parts.openings[0]!.kind).toBe('door');
  });

  it('wall layers must be mapped: unmapped layers are ignored and nothing is invented', () => {
    const r = recognize('house-mm', { layerMap: {} });
    expect(r.parts.walls).toHaveLength(0);
    expect(r.parts.openings).toHaveLength(0);
  });
});

describe('topology', () => {
  it('finds no faces in open polylines and reports free ends', () => {
    const r = recognize('gaps-duplicates');
    const topo = analyzeTopology(r.parts.walls);
    expect(topo.faces).toHaveLength(0);
    expect(topo.danglingEnds.length).toBeGreaterThan(0);
  });
});
