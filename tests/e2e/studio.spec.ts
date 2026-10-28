import { expect, test } from '@playwright/test';
import { appState, clickWall, createProject, furnitureItem, openProject } from './helpers.ts';

test.describe('studio interactions', () => {
  test('drags furniture along the floor, undoes it, and keeps it in the room', async ({ page, request }) => {
    const project = await createProject(request);
    await openProject(page, project.id);

    const before = furnitureItem(await appState(page), 'coffee-table').position;
    const from = await page.evaluate(() => window.__BUILDVIEW__!.furnitureScreenPoint('coffee-table'));
    expect(from).not.toBeNull();

    await page.mouse.move(from!.x, from!.y);
    await page.mouse.down();
    await page.mouse.move(from!.x - 70, from!.y + 15, { steps: 8 });
    await page.mouse.up();

    const afterState = await appState(page);
    const moved = furnitureItem(afterState, 'coffee-table');
    expect(moved.position).not.toEqual(before);
    expect(Math.abs(moved.position[0])).toBeLessThanOrEqual(2.5);
    expect(Math.abs(moved.position[1])).toBeLessThanOrEqual(2);
    expect(afterState.selection).toEqual({ kind: 'furniture', ids: ['coffee-table'] });
    expect(afterState.dirty).toBe(true);

    await page.getByTestId('undo').click();
    const undone = await appState(page);
    expect(furnitureItem(undone, 'coffee-table').position).toEqual(before);
    expect(undone.dirty).toBe(false);
  });

  test('rotates, resets and removes optional furniture from the properties panel', async ({ page, request }) => {
    const project = await createProject(request);
    await openProject(page, project.id);
    await page.getByTestId('tool-furniture').click();
    await page.getByTestId('furniture-item-armchair-main').click();
    const panel = page.getByTestId('properties-panel');

    await panel.getByRole('button', { name: 'Rotate right 15 degrees' }).click();
    await expect(panel.getByTestId('furniture-rotation')).toHaveText('15°');
    await panel.getByRole('button', { name: 'Reset position' }).click();
    await expect(panel.getByTestId('furniture-rotation')).toHaveText('0°');

    await panel.getByRole('button', { name: /Remove from room/ }).click();
    expect(furnitureItem(await appState(page), 'armchair-main').deleted).toBe(true);
    await page.getByTestId('undo').click();
    expect(furnitureItem(await appState(page), 'armchair-main').deleted).toBe(false);
  });

  test('switches between 2D plan and 3D, and lighting visibly changes the scene', async ({ page, request }) => {
    const project = await createProject(request);
    await openProject(page, project.id);

    const canvas = page.getByTestId('viewport').locator('canvas');
    const shot = async () => (await canvas.screenshot()).toString('base64');

    const daylight = await shot();
    await page.getByTestId('tool-lighting').click();
    await page.getByRole('radio', { name: 'Warm evening' }).click();
    await expect.poll(async () => (await appState(page)).document.lighting.preset).toBe('evening');
    await page.waitForTimeout(600);
    const evening = await shot();
    expect(evening).not.toBe(daylight);

    await page.getByTestId('interior-toggle').click();
    await page.waitForTimeout(600);
    expect(await shot()).not.toBe(evening);

    await page.getByRole('radio', { name: '2D plan' }).click();
    await expect.poll(async () => (await appState(page)).viewMode).toBe('2d');
    await page.waitForTimeout(600);
    await expect(page.getByText('5.200 m').first()).toBeVisible(); // wall dimension labels in the top-down view
    await page.getByRole('radio', { name: '3D' }).click();
    await expect.poll(async () => (await appState(page)).viewMode).toBe('3d');
  });

  test('camera: orbit, zoom, pan, reset, fit and plan mode move the real camera', async ({ page, request }) => {
    const project = await createProject(request);
    await openProject(page, project.id);
    const camera = () => page.evaluate(() => window.__BUILDVIEW__!.camera()!);
    const box = (await page.getByTestId('viewport').locator('canvas').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const initial = await camera();
    expect(initial.type).toBe('PerspectiveCamera');

    // orbit (left drag on empty space between objects)
    await page.mouse.move(cx, cy - 150);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy - 130, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(700); // damping
    const orbited = await camera();
    expect(orbited.position).not.toEqual(initial.position);

    // zoom (wheel)
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(700);
    const zoomed = await camera();
    expect(zoomed.position).not.toEqual(orbited.position);

    // pan (right drag)
    await page.mouse.move(cx, cy - 150);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(cx + 80, cy - 150, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(700);
    expect((await camera()).position).not.toEqual(zoomed.position);

    // reset returns to the initial pose
    await page.getByTestId('camera-reset').click();
    await expect
      .poll(async () => {
        const c = await camera();
        return Math.hypot(...c.position.map((v, i) => v - initial.position[i]!));
      })
      .toBeLessThan(0.05);

    // fit room moves to the overview pose (outside the room)
    await page.getByTestId('camera-fit').click();
    await expect.poll(async () => (await camera()).position[0]).toBeGreaterThan(3);

    // plan mode uses an orthographic camera looking straight down
    await page.getByRole('radio', { name: '2D plan' }).click();
    await expect.poll(async () => (await camera()).type).toBe('OrthographicCamera');
    const plan = await camera();
    expect(plan.position[1]).toBeGreaterThan(20);
    expect(Math.abs(plan.position[0])).toBeLessThan(0.01);
  });

  test('shift-click selects multiple walls and escape deselects', async ({ page, request }) => {
    const project = await createProject(request);
    await openProject(page, project.id);
    await clickWall(page, 'wall-north');
    await clickWall(page, 'wall-east', ['Shift']);
    const selection = (await appState(page)).selection;
    expect(selection?.kind).toBe('wall');
    expect([...(selection?.ids ?? [])].sort()).toEqual(['wall-east', 'wall-north']);
    await page.keyboard.press('Escape');
    expect((await appState(page)).selection).toBeNull();
  });
});
