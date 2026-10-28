import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { EdgesGeometry, LineBasicMaterial, MeshBasicMaterial, type Group } from 'three';
import { openingPlacement, wallBoxes, wallLength } from '@buildview/geometry-engine';
import { CEILING_SURFACE_ID, FLOOR_SURFACE_ID, type Opening, type Wall } from '@buildview/shared';
import { useEditor } from '../state/editorStore.ts';
import { createWorldUvBox, useSurfaceMaterial } from './materials.ts';
import { Part, useMaterials } from './primitives.tsx';
import { sceneRegistry } from './registry.ts';

const ACCENT = '#f0c070';
const noRaycast = () => null;

function setCursor(value: string) {
  document.body.style.cursor = value;
}

const WallMesh = memo(function WallMesh({ wall }: { wall: Wall }) {
  const material = useSurfaceMaterial(wall.id);
  const invalidate = useThree((s) => s.invalidate);
  const selected = useEditor((s) => s.selection?.kind === 'wall' && s.selection.ids.includes(wall.id));
  const groupRef = useRef<Group>(null);
  const [hover, setHover] = useState(false);

  const boxes = useMemo(() => wallBoxes(wall), [wall]);
  const geometries = useMemo(() => boxes.map((b) => createWorldUvBox(b.size)), [boxes]);
  const outlines = useMemo(() => geometries.map((g) => new EdgesGeometry(g)), [geometries]);
  const overlay = useMemo(
    () => new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    [],
  );
  const hoverOverlay = useMemo(
    () => new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.07, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    [],
  );
  const lineMaterial = useMemo(() => new LineBasicMaterial({ color: ACCENT }), []);

  useEffect(() => {
    const group = groupRef.current;
    if (group) sceneRegistry.walls.set(wall.id, group);
    return () => {
      sceneRegistry.walls.delete(wall.id);
    };
  }, [wall.id]);
  useEffect(
    () => () => {
      geometries.forEach((g) => g.dispose());
      outlines.forEach((g) => g.dispose());
    },
    [geometries, outlines],
  );
  useEffect(
    () => () => {
      overlay.dispose();
      hoverOverlay.dispose();
      lineMaterial.dispose();
    },
    [overlay, hoverOverlay, lineMaterial],
  );
  useEffect(() => invalidate(), [selected, hover, invalidate]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // the pointer travelled: that was an orbit/pan, not a click
    e.stopPropagation();
    useEditor.getState().selectWall(wall.id, e.nativeEvent.shiftKey);
  };

  return (
    <group ref={groupRef} name={wall.id} userData={{ wallId: wall.id }}>
      {boxes.map((box, i) => (
        <group key={box.id} position={box.center} rotation={[0, box.rotationY, 0]}>
          <mesh
            name={box.id}
            geometry={geometries[i]}
            material={material}
            castShadow
            receiveShadow
            onClick={onClick}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHover(true);
              setCursor('pointer');
            }}
            onPointerOut={() => {
              setHover(false);
              setCursor('');
            }}
          />
          {selected ? (
            <>
              <mesh geometry={geometries[i]} material={overlay} scale={[1.002, 1.002, 1.01]} raycast={noRaycast} renderOrder={2} />
              <lineSegments geometry={outlines[i]} material={lineMaterial} scale={[1.002, 1.002, 1.01]} raycast={noRaycast} renderOrder={3} />
            </>
          ) : hover ? (
            <mesh geometry={geometries[i]} material={hoverOverlay} scale={[1.002, 1.002, 1.01]} raycast={noRaycast} renderOrder={2} />
          ) : null}
        </group>
      ))}
    </group>
  );
});

function OpeningFixture({ wall, opening }: { wall: Wall; opening: Opening }) {
  const { center, rotationY } = useMemo(() => openingPlacement(wall, opening), [wall, opening]);
  const m = useMaterials({
    frame: { color: '#f4f1ea', roughness: 0.5 },
    window: { color: '#2b2f36', roughness: 0.4, metalness: 0.6 },
  });
  const glass = useMemo(
    () => ({ color: '#bfe0f5', transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false }),
    [],
  );
  const { width: w, height: h } = opening;
  const bar = 0.05;
  const t = wall.thickness;

  if (opening.kind === 'doorway') {
    return (
      <group position={center} rotation={[0, rotationY, 0]}>
        <Part at={[-w / 2 - 0.02, 0, 0]} size={[0.04, h, t + 0.02]} material={m.frame} />
        <Part at={[w / 2 + 0.02, 0, 0]} size={[0.04, h, t + 0.02]} material={m.frame} />
        <Part at={[0, h / 2 + 0.02, 0]} size={[w + 0.08, 0.04, t + 0.02]} material={m.frame} />
      </group>
    );
  }
  return (
    <group position={center} rotation={[0, rotationY, 0]}>
      <Part at={[-w / 2 + bar / 2, 0, 0]} size={[bar, h, 0.08]} material={m.window} />
      <Part at={[w / 2 - bar / 2, 0, 0]} size={[bar, h, 0.08]} material={m.window} />
      <Part at={[0, h / 2 - bar / 2, 0]} size={[w, bar, 0.08]} material={m.window} />
      <Part at={[0, -h / 2 + bar / 2, 0]} size={[w, bar, 0.08]} material={m.window} />
      <Part at={[0, 0, 0]} size={[bar * 0.7, h, 0.06]} material={m.window} />
      <mesh raycast={noRaycast} renderOrder={1}>
        <planeGeometry args={[w - bar * 2, h - bar * 2]} />
        <meshStandardMaterial {...glass} />
      </mesh>
      {/* interior sill */}
      {/* local +z faces into the room */}
      <Part at={[0, -h / 2 - 0.015, t / 2 - 0.1]} size={[w + 0.12, 0.03, 0.24]} material={m.frame} />
    </group>
  );
}

function WallDimensionLabel({ wall }: { wall: Wall }) {
  const len = wallLength(wall);
  const mid: [number, number, number] = [
    (wall.start[0] + wall.end[0]) / 2 + wall.normal[0] * (wall.thickness + 0.4),
    wall.height + 0.05,
    (wall.start[1] + wall.end[1]) / 2 + wall.normal[1] * (wall.thickness + 0.4),
  ];
  return (
    <Html position={mid} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <div className="whitespace-nowrap rounded-md border border-white/10 bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white/90">
        {len.toFixed(2)} m
      </div>
    </Html>
  );
}

export function Room() {
  const walls = useEditor((s) => s.history.present.walls);
  const room = useEditor((s) => s.history.present.room);
  const interior = useEditor((s) => s.history.present.lighting.interior);
  const viewMode = useEditor((s) => s.viewMode);
  const selection = useEditor((s) => s.selection);
  const floorMat = useSurfaceMaterial(FLOOR_SURFACE_ID);
  const ceilingMat = useSurfaceMaterial(CEILING_SURFACE_ID);
  const fixtures = useMaterials({ lamp: { color: '#fff3d6', emissive: '#ffd9a0', emissiveIntensity: 0, roughness: 0.4 } });
  const outside = useMaterials({ ground: { color: '#475645', roughness: 1 } });

  useEffect(() => {
    fixtures.lamp.emissiveIntensity = interior ? 2.2 : 0;
  }, [interior, fixtures]);

  const downlights: Array<[number, number]> = [
    [-1.2, -0.9],
    [1.2, -0.9],
    [-1.2, 0.9],
    [1.2, 0.9],
  ];

  return (
    <group name="room">
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} material={outside.ground} receiveShadow raycast={noRaycast}>
        <planeGeometry args={[60, 60]} />
      </mesh>

      {/* Floor and ceiling: planes facing into the room, so the ceiling disappears when viewed from above. */}
      <mesh name="floor" rotation={[-Math.PI / 2, 0, 0]} material={floorMat} receiveShadow>
        <planeGeometry args={[room.length, room.width]} />
      </mesh>
      <mesh name="ceiling" rotation={[Math.PI / 2, 0, 0]} position={[0, room.height, 0]} material={ceilingMat} castShadow receiveShadow>
        <planeGeometry args={[room.length, room.width]} />
      </mesh>
      {/* Single-sided discs facing down: visible from inside, culled when viewed from above. */}
      {downlights.map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, room.height - 0.004, z]} rotation={[Math.PI / 2, 0, 0]} material={fixtures.lamp} raycast={noRaycast}>
          <circleGeometry args={[0.11, 24]} />
        </mesh>
      ))}

      {walls.map((wall) => (
        <WallMesh key={wall.id} wall={wall} />
      ))}
      {walls.flatMap((wall) => wall.openings.map((o) => <OpeningFixture key={o.id} wall={wall} opening={o} />))}

      {walls.map((wall) =>
        viewMode === '2d' || (selection?.kind === 'wall' && selection.ids.includes(wall.id)) ? (
          <WallDimensionLabel key={`dim-${wall.id}`} wall={wall} />
        ) : null,
      )}
    </group>
  );
}
