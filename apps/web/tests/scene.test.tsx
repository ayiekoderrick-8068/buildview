import ReactThreeTestRenderer from '@react-three/test-renderer';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleDocument } from '@buildview/design-engine';
import { Furniture } from '../src/scene/Furniture.tsx';
import { Lighting } from '../src/scene/Lighting.tsx';
import { Room } from '../src/scene/Room.tsx';
import { sceneRegistry } from '../src/scene/registry.ts';
import { useEditor } from '../src/state/editorStore.ts';

beforeEach(() => {
  useEditor.getState().loadProject(
    { id: 'p', name: 'T', revision: 1, updatedAt: '', document: createSampleDocument(), editorMeta: {} },
    'postgres',
  );
});

const hex = (id: string) => `#${sceneRegistry.materials.get(id)?.color.getHexString().toUpperCase()}`;

describe('scene graph (headless, no WebGL)', () => {
  it('renders the room, furniture and lights without initialisation errors', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <Lighting />
        <Room />
        <Furniture />
      </>,
    );
    const { scene } = renderer;
    // four walls with stable ids, each made of real meshes
    for (const id of ['wall-north', 'wall-east', 'wall-south', 'wall-west']) {
      const group = scene.findAll((n) => n.instance.userData['wallId'] === id);
      expect(group.length).toBeGreaterThan(0);
    }
    // north wall has a window cut-out (4 boxes), south wall a doorway (3 boxes: left, right, above)
    expect(scene.findAll((n) => n.instance.name.startsWith('wall-north:')).length).toBe(4);
    expect(scene.findAll((n) => n.instance.name.startsWith('wall-south:')).length).toBe(3);
    // every furniture item is present as a group
    for (const id of ['sofa-main', 'coffee-table', 'rug-main', 'armchair-main', 'tv-console', 'plant-main', 'wall-art-main']) {
      expect(scene.findAll((n) => n.instance.name === id).length).toBe(1);
    }
    expect(scene.findAll((n) => n.instance.type === 'DirectionalLight').length).toBe(1);
    expect(scene.findAll((n) => n.instance.type === 'PointLight').length).toBe(2);
    await renderer.unmount();
  });

  it('gives every wall its own material instance and updates only the edited one', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    const mats = ['wall-north', 'wall-east', 'wall-south', 'wall-west'].map((id) => sceneRegistry.materials.get(id));
    expect(new Set(mats).size).toBe(4); // no shared material instances

    const eastBefore = hex('wall-east');
    await ReactThreeTestRenderer.act(async () => {
      useEditor.getState().paint(['wall-north'], { color: '#C4553B' });
    });
    expect(hex('wall-north')).toBe('#C4553B');
    expect(hex('wall-east')).toBe(eastBefore);
    expect(hex('wall-south')).toBe('#F1EEE6');

    await ReactThreeTestRenderer.act(async () => {
      useEditor.getState().undo();
    });
    expect(hex('wall-north')).toBe('#F1EEE6');
    await renderer.unmount();
  });

  it('keeps wall mesh dimensions identical after a material change', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    const dims = () =>
      renderer.scene
        .findAll((n) => n.instance.name.startsWith('wall-north:') && n.instance.type === 'Mesh')
        .map((n) => {
          const g = (n.instance as unknown as { geometry: { parameters: { width: number; height: number; depth: number } } }).geometry;
          return [g.parameters.width, g.parameters.height, g.parameters.depth];
        });
    const before = dims();
    await ReactThreeTestRenderer.act(async () => {
      useEditor.getState().paint(['wall-north'], { color: '#1F2F54', finish: 'gloss' });
    });
    expect(dims()).toEqual(before);
    expect(before.length).toBe(4);
    await renderer.unmount();
  });

  it('applies the plaster finish as a real bump map and removes it again', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    await ReactThreeTestRenderer.act(async () => {
      useEditor.getState().paint(['wall-north'], { finish: 'plaster' });
    });
    expect(sceneRegistry.materials.get('wall-north')?.bumpMap).toBeTruthy();
    expect(sceneRegistry.materials.get('wall-east')?.bumpMap).toBeFalsy();
    await ReactThreeTestRenderer.act(async () => {
      useEditor.getState().paint(['wall-north'], { finish: 'matte' });
    });
    expect(sceneRegistry.materials.get('wall-north')?.bumpMap).toBeFalsy();
    await renderer.unmount();
  });

  it('removes deleted furniture from the scene graph and restores it', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Furniture />);
    await ReactThreeTestRenderer.act(async () => {
      useEditor.getState().removeFurniture('plant-main');
    });
    expect(renderer.scene.findAll((n) => n.instance.name === 'plant-main').length).toBe(0);
    await ReactThreeTestRenderer.act(async () => {
      useEditor.getState().undo();
    });
    expect(renderer.scene.findAll((n) => n.instance.name === 'plant-main').length).toBe(1);
    await renderer.unmount();
  });

  it('releases registered materials on unmount', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Room />);
    expect(sceneRegistry.materials.size).toBeGreaterThan(0);
    await renderer.unmount();
    expect(sceneRegistry.materials.size).toBe(0);
  });
});
