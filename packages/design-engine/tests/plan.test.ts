import { describe, expect, it } from 'vitest';
import { hasBlockingIssues, polygonArea, validateDocument, wallLength } from '@buildview/geometry-engine';
import { SceneDocumentSchema } from '@buildview/shared';
import {
  acknowledgeIssue,
  addOpening,
  addRoom,
  addWall,
  approveModel,
  createBlankDocument,
  createSampleDocument,
  deleteOpening,
  deleteWall,
  detectMissingRooms,
  markReviewed,
  moveOpening,
  moveWallPoint,
  revokeApprovalIfEdited,
  setWallLength,
  setWallThickness,
  snapPoint,
  translateWall,
  updateOpening,
  updateSurfaces,
  upgradeDocument,
  type SnapSettings,
} from '../src/index.ts';

const snap: SnapSettings = { enabled: true, gridM: 0.1, radiusM: 0.05, endpoints: true, walls: true, grid: true, ortho: false };

describe('drawing walls', () => {
  it('draws four walls into a closed room and detects it', () => {
    let d = createBlankDocument();
    const pts = [[0, 0], [4, 0], [4, 3], [0, 3]] as const;
    for (let i = 0; i < 4; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % 4]!;
      d = addWall(d, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }).doc;
    }
    expect(d.walls.map((w) => w.id)).toEqual(['WALL-001', 'WALL-002', 'WALL-003', 'WALL-004']);
    expect(d.surfaces['WALL-001']).toBeDefined(); // default material created with the wall
    d = detectMissingRooms(d);
    expect(d.rooms).toHaveLength(1);
    expect(d.surfaces['ROOM-001:floor']).toBeDefined();
    expect(detectMissingRooms(d)).toBe(d); // idempotent: no duplicate rooms
    expect(hasBlockingIssues(validateDocument(d))).toBe(false);
    expect(SceneDocumentSchema.safeParse(d).success).toBe(true);
  });

  it('refuses zero-length walls', () => {
    const d = createBlankDocument();
    expect(addWall(d, { x: 1, y: 1 }, { x: 1, y: 1 }).id).toBeNull();
  });
});

describe('editing walls', () => {
  it('moves an endpoint and drags connected walls with it', () => {
    const d = createSampleDocument();
    const north = d.walls.find((w) => w.id === 'wall-north')!;
    const moved = moveWallPoint(d, 'wall-north', 'end', { x: north.end.x + 1, y: north.end.y });
    expect(moved.walls.find((w) => w.id === 'wall-east')!.start.x).toBeCloseTo(north.end.x + 1);
    expect(moved.walls.find((w) => w.id === 'wall-north')!.end.x).toBeCloseTo(north.end.x + 1);
    expect(moved.walls.find((w) => w.id === 'wall-south')).toBe(d.walls.find((w) => w.id === 'wall-south')); // untouched walls keep identity
    const alone = moveWallPoint(d, 'wall-north', 'end', { x: north.end.x + 1, y: north.end.y }, false);
    expect(alone.walls.find((w) => w.id === 'wall-east')).toBe(d.walls.find((w) => w.id === 'wall-east'));
  });

  it('sets exact length, thickness and translation', () => {
    const d = createSampleDocument();
    const longer = setWallLength(d, 'wall-north', 6);
    expect(wallLength(longer.walls.find((w) => w.id === 'wall-north')!)).toBeCloseTo(6);
    expect(setWallThickness(d, 'wall-north', 0.3).walls.find((w) => w.id === 'wall-north')!.thicknessM).toBe(0.3);
    const t = translateWall(d, 'wall-east', 0.5, 0);
    expect(t.walls.find((w) => w.id === 'wall-east')!.start.x).toBeCloseTo(3.1);
    expect(t.walls.find((w) => w.id === 'wall-north')!.end.x).toBeCloseTo(3.1);
  });

  it('shortening a wall below an opening makes validation flag it (nothing is silently deleted)', () => {
    const d = createSampleDocument();
    const short = setWallLength(d, 'wall-north', 1.0);
    expect(short.openings).toHaveLength(d.openings.length);
    expect(validateDocument(short).some((i) => i.severity === 'critical' && /window-main/.test(i.elementIds.join()))).toBe(true);
  });

  it('deleting a wall removes its openings but keeps its material as an orphan note', () => {
    const d = updateSurfaces(createSampleDocument(), ['wall-north'], { color: '#C4553B' });
    const gone = deleteWall(d, 'wall-north');
    expect(gone.walls.some((w) => w.id === 'wall-north')).toBe(false);
    expect(gone.openings.some((o) => o.id === 'window-main')).toBe(false);
    expect(gone.surfaces['wall-north']?.color).toBe('#C4553B');
    expect(validateDocument(gone).find((i) => i.code === 'orphan-material')?.elementIds).toContain('wall-north');
    expect(validateDocument(gone).some((i) => i.code === 'wall-gap' || i.code === 'wall-free-end')).toBe(true);
  });

  it('keeps material assignments when geometry is edited (stable element identity)', () => {
    const d = updateSurfaces(createSampleDocument(), ['wall-north'], { color: '#C4553B' });
    const edited = setWallLength(moveWallPoint(d, 'wall-north', 'start', { x: -3, y: 2.1 }), 'wall-north', 5.5);
    expect(edited.surfaces['wall-north']).toBe(d.surfaces['wall-north']);
    expect(edited.walls.find((w) => w.id === 'wall-north')!.id).toBe('wall-north');
  });
});

describe('doors and windows', () => {
  it('adds an opening to the nearest wall, clamped inside it, and slides it without overlapping neighbours', () => {
    const d = createSampleDocument();
    const east = d.walls.find((w) => w.id === 'wall-east')!;
    const added = addOpening(d, 'door', { x: east.start.x, y: 0 });
    expect(added.id).toBe('OPENING-001');
    const o = added.doc.openings.find((x) => x.id === added.id)!;
    expect(o.wallId).toBe('wall-east');
    expect(o.widthM).toBe(0.9);
    // near a corner: clamped fully inside the wall
    const edge = addOpening(d, 'window', { x: east.start.x, y: east.start.y - 0.05 });
    const e = edge.doc.openings.find((x) => x.id === edge.id)!;
    expect(e.offsetM - e.widthM / 2).toBeGreaterThanOrEqual(0);
    // sliding stops at the wall end
    const slid = moveOpening(added.doc, added.id!, 99);
    const s = slid.openings.find((x) => x.id === added.id)!;
    expect(s.offsetM + s.widthM / 2).toBeCloseTo(wallLengthOf(slid, 'wall-east'));
    expect(hasBlockingIssues(validateDocument(slid))).toBe(false);
  });

  it('refuses to place openings away from walls, and resizes with clamping', () => {
    const d = createSampleDocument();
    expect(addOpening(d, 'door', { x: 0, y: 0 }).id).toBeNull();
    const resized = updateOpening(d, 'window-main', { widthM: 3 });
    expect(resized.openings.find((o) => o.id === 'window-main')!.widthM).toBe(3);
    expect(updateOpening(d, 'window-main', { widthM: -1 })).toBe(d);
    expect(deleteOpening(d, 'window-main').openings.some((o) => o.id === 'window-main')).toBe(false);
  });

  it('moving an opening never changes wall geometry or materials', () => {
    const d = createSampleDocument();
    const moved = moveOpening(d, 'window-main', 2.0);
    expect(moved.walls).toBe(d.walls);
    expect(moved.surfaces).toBe(d.surfaces);
  });
});

describe('review and approval', () => {
  it('blocks approval while critical issues exist, then approves, and edits revoke approval', () => {
    const bad = setWallLength(createSampleDocument(), 'wall-north', 1.0);
    expect(approveModel(bad, '2026-01-01T00:00:00Z')).toBeNull();
    const good = createSampleDocument();
    const approved = approveModel(good, '2026-01-01T00:00:00Z')!;
    expect(approved.approval.status).toBe('approved');
    expect(revokeApprovalIfEdited(approved, updateSurfaces(approved, ['wall-north'], { color: '#C4553B' })).approval.status).toBe('approved'); // material edits keep approval
    expect(revokeApprovalIfEdited(approved, moveOpening(approved, 'window-main', 2)).approval.status).toBe('draft');
  });

  it('marks imported elements reviewed and acknowledges warnings', () => {
    const d = createSampleDocument();
    const flagged = { ...d, walls: d.walls.map((w) => (w.id === 'wall-east' ? { ...w, verificationStatus: 'needs-review' as const, notes: ['gap closed'] } : w)) };
    expect(validateDocument(flagged).some((i) => i.code === 'needs-review')).toBe(true);
    const reviewed = markReviewed(flagged, ['wall-east']);
    expect(reviewed.walls.find((w) => w.id === 'wall-east')!.verificationStatus).toBe('reviewed');
    expect(validateDocument(reviewed).some((i) => i.code === 'needs-review')).toBe(false);
    expect(acknowledgeIssue(d, 'x:y').acknowledgedIssues).toEqual(['x:y']);
  });

  it('draws a manual room polygon with counter-clockwise orientation', () => {
    const r = addRoom(createBlankDocument(), [{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 0 }]);
    expect(polygonArea(r.doc.rooms[0]!.polygon)).toBeCloseTo(4); // clockwise input stored counter-clockwise
  });
});

describe('snapping', () => {
  it('snaps to endpoints within the radius and not beyond it', () => {
    const d = createSampleDocument();
    const corner = d.walls[0]!.start;
    expect(snapPoint(d, { x: corner.x + 0.03, y: corner.y }, snap).kind).toBe('endpoint');
    expect(snapPoint(d, { x: corner.x + 0.03, y: corner.y }, snap).point).toEqual(corner);
    const far = snapPoint(d, { x: 0.0123, y: 0.0457 }, { ...snap, radiusM: 0.001 });
    expect(far).toEqual({ point: { x: 0.0123, y: 0.0457 }, kind: 'none' }); // never rounded outside the tolerance
    expect(snapPoint(d, { x: 0.52, y: 0.31 }, { ...snap, radiusM: 0.05 }).point).toEqual({ x: 0.5, y: 0.3 });
    expect(snapPoint(d, { x: 1, y: 1 }, { ...snap, enabled: false }).kind).toBe('none');
    expect(snapPoint(d, { x: 1, y: 0.4 }, { ...snap, enabled: false, ortho: true }, { x: 0, y: 0 }).kind).toBe('none');
  });

  it('ortho constrains to the dominant axis', () => {
    const d = createBlankDocument();
    const r = snapPoint(d, { x: 3, y: 0.4 }, { ...snap, grid: false, endpoints: false, walls: false, ortho: true }, { x: 0, y: 0 });
    expect(r.point).toEqual({ x: 3, y: 0 });
  });
});

describe('upgrade from schema v1', () => {
  it('converts a Prompt 1 document, keeping materials and flipping furniture z to plan y', () => {
    const v1 = {
      schemaVersion: 1,
      room: { length: 5, width: 4, height: 2.8, wallThickness: 0.2 },
      walls: [
        { id: 'wall-north', openings: [{ id: 'window-main', kind: 'window', offset: 2.5, width: 2.4, height: 1.9, sill: 0.5 }] },
        { id: 'wall-east', openings: [] },
        { id: 'wall-south', openings: [{ id: 'doorway-hall', kind: 'doorway', offset: 1.0, width: 0.9, height: 2.1, sill: 0 }] },
        { id: 'wall-west', openings: [] },
      ],
      surfaces: {
        'wall-north': { color: '#C4553B', finish: 'matte', roughness: 0.95, metalness: 0, textureScale: 1 },
        floor: { color: '#8A6A4B', finish: 'satin', roughness: 0.55, metalness: 0, textureScale: 1 },
        ceiling: { color: '#FAF8F3', finish: 'matte', roughness: 0.95, metalness: 0, textureScale: 1 },
      },
      furniture: [{ id: 'plant-main', kind: 'plant', name: 'Plant', position: [-2.1, -1.6], rotationY: 0, elevation: 0, size: [0.5, 1.3, 0.5], movable: true, removable: true, deleted: false, home: { position: [-2.1, -1.6], rotationY: 0 } }],
      lighting: { preset: 'evening', ambient: 1.2, sun: 1, interior: false },
    };
    const v2 = upgradeDocument(v1);
    const parsed = SceneDocumentSchema.parse(v2);
    expect(parsed.surfaces['wall-north']?.color).toBe('#C4553B');
    expect(parsed.surfaces['room-living:floor']?.finish).toBe('satin');
    expect(parsed.furniture[0]!.position).toEqual([-2.1, 1.6]);
    expect(parsed.lighting.preset).toBe('evening');
    expect(parsed.openings.find((o) => o.id === 'window-main')!.offsetM).toBeCloseTo(2.6);
    expect(upgradeDocument(parsed)).toBe(parsed);
  });
});

function wallLengthOf(d: ReturnType<typeof createSampleDocument>, id: string) {
  return wallLength(d.walls.find((w) => w.id === id)!);
}
