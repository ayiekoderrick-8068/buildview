import { Box3, Raycaster, Vector2, Vector3, type BoxGeometry, type Mesh } from 'three';
import type { SceneDocument } from '@buildview/shared';
import { sceneWalk } from './scene/WalkRig.tsx';
import { planViewRegistry, sceneRegistry } from './scene/registry.ts';
import { useEditor } from './state/editorStore.ts';

/** Test/diagnostic mode is on in dev builds and whenever the URL contains ?e2e or ?diag. */
export const isTestMode = import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e');
export const showDiagnostics = import.meta.env.DEV || new URLSearchParams(window.location.search).has('diag');

function toClient(world: Vector3): { x: number; y: number } | null {
  const { camera, gl } = sceneRegistry;
  if (!camera || !gl) return null;
  camera.updateMatrixWorld();
  const p = world.clone().project(camera);
  const rect = gl.domElement.getBoundingClientRect();
  return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

export interface TestState {
  loadState: 'loading' | 'ready' | 'error';
  storage: string | null;
  project: { id: string; name: string; revision: number } | null;
  dirty: boolean;
  save: { status: string; error: string | null; lastSavedAt: number | null };
  mode: 'build' | 'design' | 'experience';
  selection: { kind: 'wall' | 'opening' | 'room' | 'furniture'; ids: string[] } | null;
  viewMode: '3d' | '2d';
  document: SceneDocument;
  canUndo: boolean;
  canRedo: boolean;
}

export interface BuildViewTestHook {
  getState(): TestState;
  wallMaterial(id: string): { color: string; roughness: number; metalness: number; hasBump: boolean } | null;
  /** World-space size of the structural wall meshes (overlays excluded). */
  wallExtents(id: string): { x: number; y: number; z: number } | null;
  /** Number of solid boxes (mesh segments) in the wall - more than 1 means real openings were cut. */
  wallSegments(id: string): number;
  /** World-space centre of the wall's bounding box. */
  wallCenter(id: string): { x: number; y: number; z: number } | null;
  wallScreenPoint(id: string): { x: number; y: number } | null;
  furnitureScreenPoint(id: string): { x: number; y: number } | null;
  frames(): number;
  camera(): { type: string; position: [number, number, number]; zoom: number } | null;
  /** How many times each wall's geometry was rebuilt (proves edits are incremental). */
  wallBuilds(): Record<string, number>;
  walker(): { x: number; y: number; yaw: number };
  roomMeshes(): string[];
  /** Client (pixel) position of a plan coordinate in the 2D editor. */
  planToClient(x: number, y: number): { x: number; y: number } | null;
}

declare global {
  interface Window {
    __BUILDVIEW__?: BuildViewTestHook;
  }
}

function wallMeshes(id: string): Mesh[] {
  const group = sceneRegistry.walls.get(id);
  if (!group) return [];
  const out: Mesh[] = [];
  group.traverse((o) => {
    if (o.name.startsWith(`${id}:`)) out.push(o as Mesh);
  });
  return out;
}

/** Exposes real WebGL scene state (materials, bounding boxes, projected positions) to tests. */
export function installTestHook() {
  if (!isTestMode) return;
  window.__BUILDVIEW__ = {
    getState() {
      const s = useEditor.getState();
      return {
        loadState: s.loadState,
        storage: s.storage,
        project: s.project,
        dirty: s.dirty,
        save: s.save,
        mode: s.mode,
        selection: s.selection,
        viewMode: s.viewMode,
        document: s.history.present,
        canUndo: s.history.past.length > 0,
        canRedo: s.history.future.length > 0,
      };
    },
    wallMaterial(id) {
      const m = sceneRegistry.materials.get(id);
      if (!m) return null;
      return { color: `#${m.color.getHexString().toUpperCase()}`, roughness: m.roughness, metalness: m.metalness, hasBump: !!m.bumpMap };
    },
    wallExtents(id) {
      const meshes = wallMeshes(id);
      if (!meshes.length) return null;
      sceneRegistry.walls.get(id)!.updateWorldMatrix(true, true);
      const box = new Box3();
      meshes.forEach((m) => box.expandByObject(m));
      const size = box.getSize(new Vector3());
      return { x: round(size.x), y: round(size.y), z: round(size.z) };
    },
    wallSegments: (id) => wallMeshes(id).length,
    wallCenter(id) {
      const meshes = wallMeshes(id);
      if (!meshes.length) return null;
      sceneRegistry.walls.get(id)!.updateWorldMatrix(true, true);
      const box = new Box3();
      meshes.forEach((m) => box.expandByObject(m));
      const c = box.getCenter(new Vector3());
      return { x: round(c.x), y: round(c.y), z: round(c.z) };
    },
    wallScreenPoint(id) {
      // Finds a pixel where the first thing under the pointer really is this wall (visible and
      // not hidden behind furniture or another wall), by ray casting into the live scene.
      const { camera, gl, scene } = sceneRegistry;
      if (!camera || !gl || !scene) return null;
      const raycaster = new Raycaster();
      const rect = gl.domElement.getBoundingClientRect();
      camera.updateMatrixWorld();
      const meshes = wallMeshes(id).sort((a, b) => {
        const va = (a.geometry as BoxGeometry).parameters;
        const vb = (b.geometry as BoxGeometry).parameters;
        return vb.width * vb.height - va.width * va.height; // biggest segment first
      });
      for (const mesh of meshes) {
        const { width, height } = (mesh.geometry as BoxGeometry).parameters;
        for (const yf of [0.4, 0.2, 0, -0.2, 0.1]) {
          for (const xf of [0, -0.3, 0.3, -0.15, 0.15, -0.42, 0.42]) {
            const world = mesh.localToWorld(new Vector3(xf * width, yf * height, 0));
            const ndc = world.clone().project(camera);
            if (Math.abs(ndc.x) > 0.9 || Math.abs(ndc.y) > 0.9 || ndc.z > 1) continue;
            raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), camera);
            const hit = raycaster.intersectObjects(scene.children, true)[0];
            let o = hit?.object ?? null;
            while (o && o.userData['wallId'] === undefined) o = o.parent;
            if (o?.userData['wallId'] === id) {
              return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height };
            }
          }
        }
      }
      return null;
    },
    furnitureScreenPoint(id) {
      const item = useEditor.getState().history.present.furniture.find((f) => f.id === id);
      if (!item) return null;
      return toClient(new Vector3(item.position[0], item.size[1] * 0.6, -item.position[1]));
    },
    frames: () => sceneRegistry.frameCount,
    camera() {
      const cam = sceneRegistry.camera;
      if (!cam) return null;
      const zoom = 'zoom' in cam ? Number((cam as { zoom: number }).zoom) : 1;
      return { type: cam.type, position: [round(cam.position.x), round(cam.position.y), round(cam.position.z)], zoom: round(zoom) };
    },
    wallBuilds: () => Object.fromEntries(sceneRegistry.stats.wallBuilds),
    walker: () => ({ x: round(sceneWalk.pos.x), y: round(sceneWalk.pos.y), yaw: round(sceneWalk.yaw) }),
    planToClient: (x, y) => planViewRegistry.current?.toClient(x, y) ?? null,
    roomMeshes() {
      const names: string[] = [];
      sceneRegistry.scene?.traverse((o) => {
        if (o.name.endsWith(':floor') || o.name.endsWith(':ceiling')) names.push(o.name);
      });
      return names.sort();
    },
  };
}
