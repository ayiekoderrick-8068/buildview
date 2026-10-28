import { canRotateTo, resolveFurniturePosition } from '@buildview/geometry-engine';
import {
  FINISH_PRESETS,
  type Lighting,
  type SceneDocument,
  type SurfaceMaterial,
  type Vec2,
} from '@buildview/shared';

/**
 * Pure document operations. Each returns the SAME document reference when nothing changed so
 * callers can skip history entries for no-ops. None of them touch `room` or `walls`.
 */

export type SurfacePatch = Partial<SurfaceMaterial>;

export function updateSurfaces(
  doc: SceneDocument,
  surfaceIds: readonly string[],
  patch: SurfacePatch,
): SceneDocument {
  if (surfaceIds.length === 0) return doc;
  for (const id of surfaceIds) {
    if (!(id in doc.surfaces)) throw new Error(`Unknown surface: ${id}`);
  }
  const targets = new Set(surfaceIds);
  let changed = false;
  const surfaces: SceneDocument['surfaces'] = {};
  for (const [id, current] of Object.entries(doc.surfaces)) {
    if (!targets.has(id)) {
      surfaces[id] = current; // untouched surfaces keep reference identity
      continue;
    }
    const next = applyPatch(current, patch);
    if (!sameMaterial(current, next)) changed = true;
    surfaces[id] = sameMaterial(current, next) ? current : next;
  }
  return changed ? { ...doc, surfaces } : doc;
}

function applyPatch(current: SurfaceMaterial, patch: SurfacePatch): SurfaceMaterial {
  const next: SurfaceMaterial = { ...current };
  if (patch.color !== undefined) next.color = patch.color.toUpperCase();
  if (patch.finish !== undefined && patch.finish !== current.finish) {
    const preset = FINISH_PRESETS[patch.finish];
    next.finish = patch.finish;
    next.roughness = preset.roughness;
    next.metalness = preset.metalness;
  }
  const preset = FINISH_PRESETS[next.finish];
  if (patch.roughness !== undefined) next.roughness = clamp01(patch.roughness);
  // Settings that do not apply to the finish are ignored rather than silently stored.
  if (patch.metalness !== undefined && preset.metalnessAdjustable) next.metalness = clamp01(patch.metalness);
  if (patch.textureScale !== undefined && preset.textured) {
    next.textureScale = Math.min(10, Math.max(0.1, patch.textureScale));
  }
  return next;
}

function sameMaterial(a: SurfaceMaterial, b: SurfaceMaterial): boolean {
  return (
    a.color === b.color &&
    a.finish === b.finish &&
    a.roughness === b.roughness &&
    a.metalness === b.metalness &&
    a.textureScale === b.textureScale
  );
}

export function moveFurniture(doc: SceneDocument, id: string, requested: Vec2): SceneDocument {
  const item = findItem(doc, id);
  if (!item.movable || item.deleted) return doc;
  const resolved = resolveFurniturePosition(doc.room, item, doc.furniture, requested);
  // 0.1 mm precision: plenty for placement, and exact through JSON/PostgreSQL round trips.
  const position: Vec2 = [Math.round(resolved[0] * 1e4) / 1e4, Math.round(resolved[1] * 1e4) / 1e4];
  if (position[0] === item.position[0] && position[1] === item.position[1]) return doc;
  return mapItem(doc, id, { position });
}

export function rotateFurniture(doc: SceneDocument, id: string, rotationY: number): SceneDocument {
  const item = findItem(doc, id);
  if (!item.movable || item.deleted) return doc;
  const normalized = normalizeAngle(rotationY);
  if (!canRotateTo(doc.room, item, doc.furniture, normalized)) return doc;
  if (Math.abs(normalized - item.rotationY) < 1e-9) return doc;
  return mapItem(doc, id, { rotationY: normalized });
}

export function resetFurniture(doc: SceneDocument, id: string): SceneDocument {
  const item = findItem(doc, id);
  if (item.deleted) return doc;
  const { position, rotationY } = item.home;
  if (
    item.position[0] === position[0] &&
    item.position[1] === position[1] &&
    item.rotationY === rotationY
  ) {
    return doc;
  }
  return mapItem(doc, id, { position, rotationY });
}

export function deleteFurniture(doc: SceneDocument, id: string): SceneDocument {
  const item = findItem(doc, id);
  if (!item.removable || item.deleted) return doc;
  return mapItem(doc, id, { deleted: true });
}

export function restoreFurniture(doc: SceneDocument, id: string): SceneDocument {
  const item = findItem(doc, id);
  if (!item.deleted) return doc;
  const { position, rotationY } = item.home;
  return mapItem(doc, id, { deleted: false, position, rotationY });
}

export function setLighting(doc: SceneDocument, patch: Partial<Lighting>): SceneDocument {
  const next: Lighting = { ...doc.lighting, ...patch };
  if (
    next.preset === doc.lighting.preset &&
    next.ambient === doc.lighting.ambient &&
    next.sun === doc.lighting.sun &&
    next.interior === doc.lighting.interior
  ) {
    return doc;
  }
  return { ...doc, lighting: next };
}

function findItem(doc: SceneDocument, id: string) {
  const item = doc.furniture.find((f) => f.id === id);
  if (!item) throw new Error(`Unknown furniture: ${id}`);
  return item;
}

function mapItem(doc: SceneDocument, id: string, patch: Partial<SceneDocument['furniture'][number]>): SceneDocument {
  return { ...doc, furniture: doc.furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)) };
}

export function normalizeAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r > Math.PI) r -= twoPi;
  if (r <= -Math.PI) r += twoPi;
  return Math.round(r * 1e9) / 1e9;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
