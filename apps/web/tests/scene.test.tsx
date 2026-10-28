import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { BoxGeometry, Mesh } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleDocument, moveOpening, setWallLength, setWallThickness } from '@buildview/design-engine';
import { Furniture } from '../src/scene/Furniture.tsx';
import { Lighting } from '../src/scene/Lighting.tsx';
import { Room } from '../src/scene/Room.tsx';
import { sceneRegistry } from '../src/scene/registry.ts';
import { useEditor } from '../src/state/editorStore.ts';

function load(doc = createSampleDocument()) {
  useEditor.getState().loadProject({ id: 'p', name: 'T', revision: 1, updatedAt: '', document: doc, editorMeta: {} }, 'postgres');
}
beforeEach(() => {
  sceneRegistry.stats.wallBuilds.clear();
  load();
});

const hex = (id: string) => `#${sceneRegistry.materials.get(id)?.color.getHexString().toUpperCase()}`;
const dims = (renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>, wallId: string) =>
  renderer.scene.findAll((n) => n.instance.name.startsWith(`${wallId}:`) && n.instance.type === 'Mesh').map((n) => {
    const p = ((n.instance as Mesh).geometry as BoxGeometry).parameters;
    return [p.width, p.height, p.depth].map((v) => Math.round(v * 1e4) / 1e4);
  });

describe('scene graph (headless, no WebGL)', () => {
  it('renders the building, furniture and lights without initialisation errors', async () => {
    const renderer = await ReactThreeTestRenderer.create(<><Lighting /><Room /><Furniture /></>);
    const { scene } = renderer;
    for (const id of ['wall-north', 'wall-east', 'wall-south', 'wall-west']) {
      expect(scene.findAll((n) => n.instance.userData['wallId'] === id).length).toBeGreaterThan(0);
    }
    expect(scene.findAll((n) => n.instance.name.startsWith('wall-north:')).length).toBe(4); // window cut-out
    expect(scene.findAll((n) => n.instance.name.startsWith('wall-south:')).length).toBe(3); // doorway cut-out
    expect(scene.findAll((n) => n.instance.name === 'room-living:floor').length).toBe(1);
    expect(scene.findAll((n) => n.instance.name === 'room-living:ceiling').length).toBe(1);
    for (const id of ['sofa-main', 'coffee-table', 'rug-main', 'armchair-main', 'tv-console', 'plant-main', 'wall-art-main']) {
      expect(scene.findAll((n) => n.instance.name === id).length).toBe(1);
    }
    expect(scene.findAll((n) => n.instance.type === 'DirectionalLight').length).toBe(1);
    expect(scene.findAll((n) => n.instance.type === 'PointLight').length).toBe(2);
    await renderer.unmount();
  });

  it('puts walls at the documented plan -> world mapping (world z = -plan y)', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    const north = renderer.scene.findAll((n) => n.instance.name.startsWith('wall-north:solid-0'))[0]!.instance;
    const world = north.parent!.position; // box group
    expect(world.z).toBeCloseTo(-2.1); // north wall centre line at plan y = +2.1
    expect(world.y).toBeCloseTo(1.4);
    await renderer.unmount();
  });

  it('gives every wall its own material instance and updates only the edited one', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    const mats = ['wall-north', 'wall-east', 'wall-south', 'wall-west'].map((id) => sceneRegistry.materials.get(id));
    expect(new Set(mats).size).toBe(4);
    const eastBefore = hex('wall-east');
    await ReactThreeTestRenderer.act(async () => useEditor.getState().paint(['wall-north'], { color: '#C4553B' }));
    expect(hex('wall-north')).toBe('#C4553B');
    expect(hex('wall-east')).toBe(eastBefore);
    expect(hex('wall-south')).toBe('#F1EEE6');
    await ReactThreeTestRenderer.act(async () => useEditor.getState().undo());
    expect(hex('wall-north')).toBe('#F1EEE6');
    await renderer.unmount();
  });

  it('keeps wall mesh dimensions identical after a material change', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    const before = dims(renderer, 'wall-north');
    expect(before.length).toBe(4);
    await ReactThreeTestRenderer.act(async () => useEditor.getState().paint(['wall-north'], { color: '#1F2F54', finish: 'gloss' }));
    expect(dims(renderer, 'wall-north')).toEqual(before);
    expect(sceneRegistry.stats.wallBuilds.get('wall-north')).toBe(1); // no rebuild for a paint change
    await renderer.unmount();
  });

  it('floors and ceilings have their own materials', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    await ReactThreeTestRenderer.act(async () => useEditor.getState().paint(['room-living:floor'], { color: '#CCBBAA' }));
    expect(hex('room-living:floor')).toBe('#CCBBAA');
    expect(hex('room-living:ceiling')).toBe('#FAF8F3');
    await renderer.unmount();
  });

  it('regenerates only the edited wall (and joined neighbours) when geometry changes', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    sceneRegistry.stats.wallBuilds.clear();
    await ReactThreeTestRenderer.act(async () => useEditor.getState().setWallThicknessM('wall-north', 0.3));
    // thickness changes the north wall itself and the corner joins of the walls that meet it
    expect(sceneRegistry.stats.wallBuilds.get('wall-north')).toBe(1);
    expect(sceneRegistry.stats.wallBuilds.get('wall-east')).toBe(1);
    expect(sceneRegistry.stats.wallBuilds.get('wall-west')).toBe(1);
    expect(sceneRegistry.stats.wallBuilds.get('wall-south')).toBeUndefined(); // untouched
    expect(dims(renderer, 'wall-north')[0]![2]).toBe(0.3);
    await renderer.unmount();
  });

  it('moving an opening rebuilds only its host wall and shifts the cut-out', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    const left = () => dims(renderer, 'wall-north')[0]![0]!;
    const before = left();
    sceneRegistry.stats.wallBuilds.clear();
    await ReactThreeTestRenderer.act(async () => useEditor.getState().moveOpeningTo('window-main', 2.0));
    expect([...sceneRegistry.stats.wallBuilds.keys()]).toEqual(['wall-north']);
    expect(left()).toBeLessThan(before); // left solid segment shrank as the window moved left
    await renderer.unmount();
  });

  it('2D model edits and the 3D scene stay in sync (length change, delete, undo)', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    const total = () => dims(renderer, 'wall-east').reduce((s, d) => s + d[0]!, 0);
    const initial = total();
    expect(initial).toBeCloseTo(4.4); // 4.2 m centre line + 0.1 m corner fill at each end
    await ReactThreeTestRenderer.act(async () => useEditor.getState().setWallLengthM('wall-east', 3.0));
    expect(total()).toBeCloseTo(initial - 1.2);
    await ReactThreeTestRenderer.act(async () => {
      useEditor.getState().select('wall', ['wall-east']);
      useEditor.getState().deleteSelection();
    });
    expect(renderer.scene.findAll((n) => n.instance.userData['wallId'] === 'wall-east').length).toBe(0);
    await ReactThreeTestRenderer.act(async () => useEditor.getState().undo());
    expect(total()).toBeCloseTo(initial - 1.2);
    await renderer.unmount();
  });

  it('keeps a wall material when its geometry is edited and regenerated', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    await ReactThreeTestRenderer.act(async () => useEditor.getState().paint(['wall-north'], { color: '#C4553B' }));
    await ReactThreeTestRenderer.act(async () => useEditor.getState().setWallLengthM('wall-north', 6));
    expect(hex('wall-north')).toBe('#C4553B');
    await renderer.unmount();
  });

  it('applies the plaster finish as a real bump map and removes it again', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    await ReactThreeTestRenderer.act(async () => useEditor.getState().paint(['wall-north'], { finish: 'plaster' }));
    expect(sceneRegistry.materials.get('wall-north')?.bumpMap).toBeTruthy();
    expect(sceneRegistry.materials.get('wall-east')?.bumpMap).toBeFalsy();
    await ReactThreeTestRenderer.act(async () => useEditor.getState().paint(['wall-north'], { finish: 'matte' }));
    expect(sceneRegistry.materials.get('wall-north')?.bumpMap).toBeFalsy();
    await renderer.unmount();
  });

  it('renders a flat roof only when the user enables it', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    expect(renderer.scene.findAll((n) => n.instance.name === 'roof').length).toBe(0);
    await ReactThreeTestRenderer.act(async () => useEditor.getState().setRoofSettings({ kind: 'flat', thicknessM: 0.2, overhangM: 0.3 }));
    expect(renderer.scene.findAll((n) => n.instance.name === 'roof').length).toBe(1);
    await renderer.unmount();
  });

  it('removes deleted furniture from the scene graph and restores it', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Furniture />);
    await ReactThreeTestRenderer.act(async () => useEditor.getState().removeFurniture('plant-main'));
    expect(renderer.scene.findAll((n) => n.instance.name === 'plant-main').length).toBe(0);
    await ReactThreeTestRenderer.act(async () => useEditor.getState().undo());
    expect(renderer.scene.findAll((n) => n.instance.name === 'plant-main').length).toBe(1);
    await renderer.unmount();
  });

  it('places furniture using plan coordinates (world z = -plan y)', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Furniture />);
    const plant = renderer.scene.findAll((n) => n.instance.name === 'plant-main')[0]!.instance;
    expect(plant.position.x).toBeCloseTo(-2.1);
    expect(plant.position.z).toBeCloseTo(-1.6); // plan y = +1.6
    await renderer.unmount();
  });

  it('releases registered materials on unmount', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    expect(sceneRegistry.materials.size).toBeGreaterThan(0);
    await renderer.unmount();
    expect(sceneRegistry.materials.size).toBe(0);
  });
});

describe('document edits used above', () => {
  it('are pure and keep unrelated walls by reference', () => {
    const d = createSampleDocument();
    const t = setWallThickness(d, 'wall-north', 0.3);
    expect(t.walls.find((w) => w.id === 'wall-south')).toBe(d.walls.find((w) => w.id === 'wall-south'));
    expect(moveOpening(d, 'window-main', 2.0).walls).toBe(d.walls);
    expect(setWallLength(d, 'wall-east', 3).openings).toBe(d.openings);
  });
});
