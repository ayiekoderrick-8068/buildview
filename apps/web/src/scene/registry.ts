import type { Camera, Group, MeshStandardMaterial, Scene, WebGLRenderer } from 'three';

/**
 * Live handles to the objects actually inside the WebGL scene. Used by the diagnostics overlay and
 * by the `window.__BUILDVIEW__` test hook so tests can assert on rendered state, not just on
 * store state.
 */
/** Live transform of the 2D plan editor (set by PlanEditor, read by the test hook). */
export const planViewRegistry: { current: null | { toClient: (x: number, y: number) => { x: number; y: number }; scale: number } } = { current: null };

export const sceneRegistry = {
  materials: new Map<string, MeshStandardMaterial>(),
  walls: new Map<string, Group>(),
  gl: null as WebGLRenderer | null,
  scene: null as Scene | null,
  camera: null as Camera | null,
  frameCount: 0,
  /** Counters proving that edits rebuild only what changed. */
  stats: { geometryBuilds: 0, wallBuilds: new Map<string, number>() as Map<string, number> },
};
