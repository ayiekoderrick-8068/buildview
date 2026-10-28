import type { Camera, Group, MeshStandardMaterial, Scene, WebGLRenderer } from 'three';

/**
 * Live handles to the objects actually inside the WebGL scene. Used by the diagnostics overlay and
 * by the `window.__BUILDVIEW__` test hook so tests can assert on rendered state, not just on
 * store state.
 */
export const sceneRegistry = {
  materials: new Map<string, MeshStandardMaterial>(),
  walls: new Map<string, Group>(),
  gl: null as WebGLRenderer | null,
  scene: null as Scene | null,
  camera: null as Camera | null,
  frameCount: 0,
};
