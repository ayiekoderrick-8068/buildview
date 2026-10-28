import { useEffect, useMemo, useRef } from 'react';
import { PerspectiveCamera } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { buildWalkObstacles, walkStep, polygonArea } from '@buildview/geometry-engine';
import { useEditor } from '../state/editorStore.ts';
import { polygonCentroid } from './buildingInfo.ts';

const EYE_M = 1.6;
const RADIUS_M = 0.25;
const SPEED = 1.6; // m/s walking
const KEYS: Record<string, 'f' | 'b' | 'l' | 'r' | 'tl' | 'tr'> = {
  w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', d: 'r', arrowleft: 'tl', arrowright: 'tr',
};

/**
 * First-person walkthrough: WASD / arrow keys to move, drag the view to look around. The body is
 * a 0.25 m radius circle tested against the real wall geometry (door openings are walkable,
 * window sills and walls block). Not a physics engine: no stairs, gravity or furniture collision.
 */
export function WalkRig() {
  const walls = useEditor((s) => s.history.present.walls);
  const openings = useEditor((s) => s.history.present.openings);
  const rooms = useEditor((s) => s.history.present.rooms);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const obstacles = useMemo(() => buildWalkObstacles(walls, openings), [walls, openings]);
  const obstaclesRef = useRef(obstacles);
  obstaclesRef.current = obstacles;
  const state = useRef({ x: 0, y: 0, yaw: Math.PI, pitch: 0, keys: new Set<string>(), last: 0 });

  // Start in the largest room, looking along its longest axis.
  useEffect(() => {
    const room = [...rooms].sort((a, b) => Math.abs(polygonArea(b.polygon)) - Math.abs(polygonArea(a.polygon)))[0];
    const c = room ? polygonCentroid(room.polygon) : { x: 0, y: 0 };
    state.current.x = c.x;
    state.current.y = c.y;
    state.current.yaw = Math.PI; // facing plan -y (south) is yaw PI with yaw 0 = north
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (KEYS[k]) {
        state.current.keys.add(KEYS[k]!);
        e.preventDefault();
        invalidate();
      }
    };
    const up = (e: KeyboardEvent) => state.current.keys.delete(KEYS[e.key.toLowerCase()] ?? '');
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    const el = gl.domElement;
    let dragging = false;
    const pd = () => (dragging = true);
    const pu = () => (dragging = false);
    const pm = (e: PointerEvent) => {
      if (!dragging) return;
      state.current.yaw -= e.movementX * 0.005;
      state.current.pitch = Math.max(-1.2, Math.min(1.2, state.current.pitch - e.movementY * 0.004));
      invalidate();
    };
    el.addEventListener('pointerdown', pd);
    window.addEventListener('pointerup', pu);
    window.addEventListener('pointermove', pm);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      el.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointerup', pu);
      window.removeEventListener('pointermove', pm);
    };
  }, [gl, invalidate]);

  useFrame((_, delta) => {
    const s = state.current;
    const dt = Math.min(delta, 0.1);
    const turn = (s.keys.has('tl') ? 1 : 0) - (s.keys.has('tr') ? 1 : 0);
    if (turn) s.yaw += turn * 1.8 * dt;
    const fwd = (s.keys.has('f') ? 1 : 0) - (s.keys.has('b') ? 1 : 0);
    const strafe = (s.keys.has('r') ? 1 : 0) - (s.keys.has('l') ? 1 : 0);
    if (fwd || strafe) {
      // yaw 0 faces plan +y (north); plan right = +x at yaw 0
      const fx = -Math.sin(s.yaw);
      const fy = Math.cos(s.yaw);
      const rx = Math.cos(s.yaw);
      const ry = Math.sin(s.yaw);
      const to = { x: s.x + (fx * fwd + rx * strafe) * SPEED * dt, y: s.y + (fy * fwd + ry * strafe) * SPEED * dt };
      const next = walkStep({ x: s.x, y: s.y }, to, RADIUS_M, obstaclesRef.current);
      s.x = next.x;
      s.y = next.y;
    }
    if (fwd || strafe || turn || s.keys.size) invalidate();
    camera.position.set(s.x, EYE_M, -s.y);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(s.pitch, s.yaw, 0);
    sceneWalk.pos = { x: s.x, y: s.y };
    sceneWalk.yaw = s.yaw;
  });

  return <PerspectiveCamera makeDefault fov={70} near={0.05} far={300} />;
}

/** Read-only view of the walker for tests and diagnostics. */
export const sceneWalk = { pos: { x: 0, y: 0 }, yaw: 0 };
