import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { BoxGeometry, EdgesGeometry, ExtrudeGeometry, LineBasicMaterial, MeshBasicMaterial, Shape, ShapeGeometry, Vector2, type Group } from 'three';
import { convexHull, insetPolygon, openingPlacement, wallBoxes, wallExtensions } from '@buildview/geometry-engine';
import { ceilingSurfaceId, floorSurfaceId, ROOF_SURFACE_ID, type Opening, type Roof as RoofSetting, type Room as RoomModel, type Wall } from '@buildview/shared';
import { useEditor } from '../state/editorStore.ts';
import { buildingBounds, roomLightPoints } from './buildingInfo.ts';
import { createWorldUvBox, useSurfaceMaterial } from './materials.ts';
import { Part, useMaterials } from './primitives.tsx';
import { sceneRegistry } from './registry.ts';

const ACCENT = '#f0c070';
const noRaycast = () => null;
const setCursor = (value: string) => {
  document.body.style.cursor = value;
};

/** Click handler shared by every selectable building element: ignores orbit drags, supports Shift to extend. */
function useSelectable(kind: 'wall' | 'opening' | 'room', id: string) {
  return (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    e.stopPropagation();
    const s = useEditor.getState();
    if (s.mode === 'experience') return;
    if (kind === 'wall') s.selectWall(id, e.nativeEvent.shiftKey);
    else s.select(kind, [id]);
  };
}

interface WallMeshProps {
  wall: Wall;
  extStart: number;
  extEnd: number;
}

const WallMesh = memo(function WallMesh({ wall, extStart, extEnd }: WallMeshProps) {
  const material = useSurfaceMaterial(wall.id);
  const invalidate = useThree((s) => s.invalidate);
  const selected = useEditor((s) => s.selection?.kind === 'wall' && s.selection.ids.includes(wall.id));
  const allOpenings = useEditor((s) => s.history.present.openings);
  const groupRef = useRef<Group>(null);
  const [hover, setHover] = useState(false);
  const onClick = useSelectable('wall', wall.id);

  const mine = useMemo(() => allOpenings.filter((o) => o.wallId === wall.id), [allOpenings, wall.id]);
  // Geometry depends only on this wall, its neighbours' joins and its own openings: nothing else rebuilds it.
  const key = JSON.stringify([wall.start, wall.end, wall.thicknessM, wall.heightM, extStart, extEnd, mine.map((o) => [o.id, o.offsetM, o.widthM, o.heightM, o.sillM])]);
  const boxes = useMemo(() => {
    sceneRegistry.stats.wallBuilds.set(wall.id, (sceneRegistry.stats.wallBuilds.get(wall.id) ?? 0) + 1);
    return wallBoxes(wall, mine, { start: extStart, end: extEnd });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const geometries = useMemo(() => boxes.map((b) => createWorldUvBox(b.size)), [boxes]);
  const outlines = useMemo(() => geometries.map((g) => new EdgesGeometry(g)), [geometries]);
  const overlay = useMemo(() => new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), []);
  const hoverOverlay = useMemo(() => new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.07, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), []);
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
  useEffect(() => invalidate(), [selected, hover, boxes, invalidate]);

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
  const selected = useEditor((s) => s.selection?.kind === 'opening' && s.selection.ids.includes(opening.id));
  const onClick = useSelectable('opening', opening.id);
  const m = useMaterials({
    frame: { color: '#f4f1ea', roughness: 0.5 },
    window: { color: '#2b2f36', roughness: 0.4, metalness: 0.6 },
    leaf: { color: '#8a6a4b', roughness: 0.6 },
  });
  const glass = useMemo(() => ({ color: '#bfe0f5', transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false }), []);
  const outline = useMemo(() => {
    const box = new BoxGeometry(opening.widthM + 0.08, opening.heightM + 0.08, wall.thicknessM + 0.08);
    const e = new EdgesGeometry(box);
    box.dispose();
    return e;
  }, [opening.widthM, opening.heightM, wall.thicknessM]);
  const lineMat = useMemo(() => new LineBasicMaterial({ color: ACCENT }), []);
  useEffect(() => () => outline.dispose(), [outline]);
  useEffect(() => () => lineMat.dispose(), [lineMat]);
  const { widthM: w, heightM: h } = opening;
  const bar = 0.05;
  const t = wall.thicknessM;
  const glazed = opening.kind === 'window' || opening.kind === 'glazed-door';

  return (
    <group position={center} rotation={[0, rotationY, 0]} name={opening.id} onClick={onClick}>
      {opening.kind === 'doorway' || opening.kind === 'door' ? (
        <>
          <Part at={[-w / 2 - 0.02, 0, 0]} size={[0.04, h, t + 0.02]} material={m.frame} />
          <Part at={[w / 2 + 0.02, 0, 0]} size={[0.04, h, t + 0.02]} material={m.frame} />
          <Part at={[0, h / 2 + 0.02, 0]} size={[w + 0.08, 0.04, t + 0.02]} material={m.frame} />
          {opening.kind === 'door' ? <Part at={[w * 0.46, 0, 0]} size={[w * 0.08, h, 0.03]} material={m.leaf} /> : null}
        </>
      ) : null}
      {glazed ? (
        <>
          <Part at={[-w / 2 + bar / 2, 0, 0]} size={[bar, h, 0.08]} material={m.window} />
          <Part at={[w / 2 - bar / 2, 0, 0]} size={[bar, h, 0.08]} material={m.window} />
          <Part at={[0, h / 2 - bar / 2, 0]} size={[w, bar, 0.08]} material={m.window} />
          <Part at={[0, -h / 2 + bar / 2, 0]} size={[w, bar, 0.08]} material={m.window} />
          {w > 0.9 ? <Part at={[0, 0, 0]} size={[bar * 0.7, h, 0.06]} material={m.window} /> : null}
          <mesh raycast={noRaycast} renderOrder={1}>
            <planeGeometry args={[w - bar * 2, h - bar * 2]} />
            <meshStandardMaterial {...glass} />
          </mesh>
        </>
      ) : null}
      {selected ? <lineSegments geometry={outline} material={lineMat} raycast={noRaycast} renderOrder={3} /> : null}
    </group>
  );
}

function RoomSurfaces({ room, ceilingM }: { room: RoomModel; ceilingM: number }) {
  const floorMat = useSurfaceMaterial(floorSurfaceId(room.id));
  const ceilingMat = useSurfaceMaterial(ceilingSurfaceId(room.id), 'back');
  const selected = useEditor((s) => s.selection?.kind === 'room' && s.selection.ids.includes(room.id));
  const onClick = useSelectable('room', room.id);
  const geometry = useMemo(() => new ShapeGeometry(new Shape(room.polygon.map((p) => new Vector2(p.x, p.y)))), [room.polygon]);
  const highlight = useMemo(() => new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.22, depthWrite: false }), []);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => highlight.dispose(), [highlight]);
  useEffect(() => invalidate(), [selected, geometry, invalidate]);
  const lamp = useMaterials({ lamp: { color: '#fff3d6', emissive: '#ffd9a0', emissiveIntensity: 2.2, roughness: 0.4 } });
  const interior = useEditor((s) => s.history.present.lighting.interior);
  useEffect(() => {
    lamp.lamp.emissiveIntensity = interior ? 2.2 : 0;
    invalidate();
  }, [interior, lamp, invalidate]);
  const lights = useMemo(() => roomLightPoints(room), [room]);

  // plan (x, y) -> world (x, h, -y): a shape in the XY plane rotated -90 degrees about X.
  return (
    <group name={room.id} userData={{ roomId: room.id }}>
      <mesh name={`${room.id}:floor`} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} material={floorMat} receiveShadow onClick={onClick} />
      <mesh name={`${room.id}:ceiling`} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, ceilingM, 0]} material={ceilingMat} castShadow receiveShadow raycast={noRaycast} />
      {selected ? <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} material={highlight} raycast={noRaycast} renderOrder={2} /> : null}
      {lights.map((p, i) => (
        <mesh key={i} position={[p.x, ceilingM - 0.004, -p.y]} rotation={[Math.PI / 2, 0, 0]} material={lamp.lamp} raycast={noRaycast}>
          <circleGeometry args={[0.11, 24]} />
        </mesh>
      ))}
    </group>
  );
}

function Roof({ doc }: { doc: { walls: Wall[]; roof: RoofSetting } }) {
  const material = useSurfaceMaterial(ROOF_SURFACE_ID);
  const geometry = useMemo(() => {
    const pts = doc.walls.flatMap((w) => [w.start, w.end]);
    const hull = convexHull(pts);
    if (hull.length < 3) return null;
    const maxT = Math.max(...doc.walls.map((w) => w.thicknessM));
    const grow = maxT / 2 + doc.roof.overhangM;
    const outer = insetPolygon(hull, hull.map(() => -2 * grow)) ?? hull;
    return new ExtrudeGeometry(new Shape(outer.map((p) => new Vector2(p.x, p.y))), { depth: doc.roof.thicknessM, bevelEnabled: false });
  }, [doc]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  const top = Math.max(...doc.walls.map((w) => w.heightM));
  return <mesh name="roof" geometry={geometry} material={material} rotation={[-Math.PI / 2, 0, 0]} position={[0, top, 0]} castShadow receiveShadow raycast={noRaycast} />;
}
const useRoofSetting = () => useEditor((s) => s.history.present.roof);

export function Room() {
  const walls = useEditor((s) => s.history.present.walls);
  const openings = useEditor((s) => s.history.present.openings);
  const rooms = useEditor((s) => s.history.present.rooms);
  const levels = useEditor((s) => s.history.present.levels);
  const roof = useRoofSetting();
  const outside = useMaterials({ ground: { color: '#475645', roughness: 1 } });
  const ext = useMemo(() => wallExtensions(walls), [walls]);
  const centre = useMemo(() => buildingBounds({ walls, rooms }).center, [walls, rooms]);
  const wallsById = useMemo(() => new Map(walls.map((w) => [w.id, w])), [walls]);

  return (
    <group name="room">
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centre.x, -0.04, -centre.y]} material={outside.ground} receiveShadow raycast={noRaycast}>
        <planeGeometry args={[120, 120]} />
      </mesh>
      {rooms.map((r) => (
        <RoomSurfaces key={r.id} room={r} ceilingM={levels.find((l) => l.id === r.levelId)?.heightM ?? levels[0]?.heightM ?? 2.8} />
      ))}
      {walls.map((w) => (
        <WallMesh key={w.id} wall={w} extStart={ext.get(w.id)?.start ?? 0} extEnd={ext.get(w.id)?.end ?? 0} />
      ))}
      {openings.map((o) => {
        const host = wallsById.get(o.wallId);
        return host ? <OpeningFixture key={o.id} wall={host} opening={o} /> : null;
      })}
      {roof && walls.length >= 2 ? <Roof doc={{ walls, roof }} /> : null}
    </group>
  );
}
