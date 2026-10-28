import { createRectangularHouse } from '@buildview/geometry-engine';
import { SCHEMA_VERSION, floorSurfaceId, ceilingSurfaceId, type SceneDocument } from '@buildview/shared';
import { createBlankDocument, ensureSurfaces } from './sample.ts';

/**
 * Upgrades a stored Prompt-1 (schema v1) document to v2. v1 stored one rectangular room with
 * interior-face walls; v2 stores centreline walls. Material assignments, furniture and lighting
 * are carried over; furniture z becomes plan y (y = -z). Documents already at v2 pass through.
 */
export function upgradeDocument(raw: unknown): unknown {
  const doc = raw as { schemaVersion?: number } | null;
  if (!doc || doc.schemaVersion !== 1) return raw;
  const v1 = doc as unknown as {
    room: { length: number; width: number; height: number; wallThickness: number };
    walls: Array<{ id: string; openings: Array<{ id: string; kind: string; offset: number; width: number; height: number; sill: number }> }>;
    surfaces: SceneDocument['surfaces'];
    furniture: Array<Record<string, unknown> & { position: [number, number]; home: { position: [number, number]; rotationY: number } }>;
    lighting: SceneDocument['lighting'];
  };
  const t = v1.room.wallThickness;
  const side = (id: string) => v1.walls.find((w) => w.id === `wall-${id}`)?.openings ?? [];
  const mapOpenings = (id: string) =>
    side(id).map((o) => ({
      id: o.id,
      kind: (o.kind === 'doorway' ? 'doorway' : o.kind === 'glazed-door' ? 'glazed-door' : 'window') as 'doorway' | 'glazed-door' | 'window',
      // v1 measured from the interior corner; v2 measures from the centreline corner (t/2 further out)
      offsetM: o.offset + t / 2,
      widthM: o.width,
      heightM: o.height,
      sillM: o.sill,
    }));
  const geometry = createRectangularHouse(
    { lengthM: v1.room.length, widthM: v1.room.width, heightM: v1.room.height, wallThicknessM: t },
    { north: mapOpenings('north'), east: mapOpenings('east'), south: mapOpenings('south'), west: mapOpenings('west') },
  );
  const surfaces = { ...v1.surfaces };
  const roomId = geometry.rooms[0]!.id;
  if (surfaces['floor']) {
    surfaces[floorSurfaceId(roomId)] = surfaces['floor'];
    delete surfaces['floor'];
  }
  if (surfaces['ceiling']) {
    surfaces[ceilingSurfaceId(roomId)] = surfaces['ceiling'];
    delete surfaces['ceiling'];
  }
  const flip = (p: [number, number]): [number, number] => [p[0], -p[1] === 0 ? 0 : -p[1]];
  const furniture = v1.furniture.map((f) => ({ ...f, position: flip(f.position), home: { ...f.home, position: flip(f.home.position) } }));
  return ensureSurfaces({
    ...createBlankDocument(),
    schemaVersion: SCHEMA_VERSION,
    ...geometry,
    surfaces,
    furniture: furniture as unknown as SceneDocument['furniture'],
    lighting: v1.lighting,
  });
}
