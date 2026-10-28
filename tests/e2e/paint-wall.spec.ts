import { expect, test } from '@playwright/test';
import { appState, clickWall, createProject, openProject, wallExtents, wallMaterial } from './helpers.ts';

const SKY_BLUE = '#87B4D8';
const TERRACOTTA = '#C4553B';

test.describe('wall painting workflow', () => {
  test('select, repaint blue -> red, verify scene, save, reload, verify restored', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // 1. Open the sample project (fresh, via the real API/database).
    const project = await createProject(request);
    await openProject(page, project.id);
    const properties = page.getByTestId('properties-panel');

    // 2. Select a wall by clicking it in the 3D viewport.
    await clickWall(page, 'wall-north');
    await expect(properties.getByTestId('wall-id')).toHaveText('wall-north');
    expect((await appState(page)).selection).toEqual({ kind: 'wall', ids: ['wall-north'] });

    const lengthBefore = await properties.getByTestId('wall-length').textContent();
    const extentsBefore = await wallExtents(page, 'wall-north');
    const othersBefore = {
      east: await wallMaterial(page, 'wall-east'),
      south: await wallMaterial(page, 'wall-south'),
      west: await wallMaterial(page, 'wall-west'),
    };
    expect(lengthBefore).toBe('5.20 m'); // centre line = 5.0 m interior + one 0.2 m thickness

    // 3. Change colour to blue, then red, using the real UI controls.
    await properties.getByRole('button', { name: /^Sky Blue/ }).click();
    await expect.poll(async () => (await wallMaterial(page, 'wall-north'))?.color).toBe(SKY_BLUE);
    await properties.getByRole('button', { name: /^Terracotta Red/ }).click();

    // 4. The actual three.js material of the selected wall changed...
    await expect.poll(async () => (await wallMaterial(page, 'wall-north'))?.color).toBe(TERRACOTTA);
    await expect(properties.getByTestId('current-color')).toHaveText(TERRACOTTA);

    // ...and only that wall's.
    expect(await wallMaterial(page, 'wall-east')).toEqual(othersBefore.east);
    expect(await wallMaterial(page, 'wall-south')).toEqual(othersBefore.south);
    expect(await wallMaterial(page, 'wall-west')).toEqual(othersBefore.west);

    // 5. Dimensions did not change: UI readout, store geometry, and rendered bounding box.
    await expect(properties.getByTestId('wall-length')).toHaveText(lengthBefore!);
    expect(await wallExtents(page, 'wall-north')).toEqual(extentsBefore);

    // Unsaved indicator is shown.
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'dirty');

    // 6. Save, and wait for the server to confirm.
    await page.getByTestId('save').click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    expect((await appState(page)).project!.revision).toBe(2);

    // 7. Reload the page.
    await page.reload();
    await page.waitForFunction(() => window.__BUILDVIEW__?.getState().loadState === 'ready');
    await page.waitForFunction(() => window.__BUILDVIEW__?.wallMaterial('wall-north') != null);

    // 8. The red material is restored in the real scene, from the database.
    await expect.poll(async () => (await wallMaterial(page, 'wall-north'))?.color).toBe(TERRACOTTA);
    expect(await wallExtents(page, 'wall-north')).toEqual(extentsBefore);
    expect((await appState(page)).dirty).toBe(false);
    expect((await appState(page)).project!.revision).toBe(2);

    expect(errors).toEqual([]);
  });

  test('undo/redo and apply-to-all-walls through the UI', async ({ page, request }) => {
    const project = await createProject(request);
    await openProject(page, project.id);
    const properties = page.getByTestId('properties-panel');

    await clickWall(page, 'wall-north');
    await properties.getByRole('button', { name: /^Navy Blue/ }).click();
    await expect.poll(async () => (await wallMaterial(page, 'wall-north'))?.color).toBe('#1F2F54');

    await page.getByTestId('undo').click();
    await expect.poll(async () => (await wallMaterial(page, 'wall-north'))?.color).toBe('#F1EEE6');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    await page.getByTestId('redo').click();
    await expect.poll(async () => (await wallMaterial(page, 'wall-north'))?.color).toBe('#1F2F54');

    await properties.getByRole('radio', { name: 'All walls' }).click();
    await properties.getByRole('button', { name: /^Charcoal/ }).click();
    for (const id of ['wall-north', 'wall-east', 'wall-south', 'wall-west']) {
      await expect.poll(async () => (await wallMaterial(page, id))?.color).toBe('#3A3D42');
    }
  });

  test('shows a clear error and stays dirty when saving fails', async ({ page, request }) => {
    const project = await createProject(request);
    await openProject(page, project.id);
    await clickWall(page, 'wall-north');
    await page.getByTestId('properties-panel').getByRole('button', { name: /^Olive/ }).click();

    await page.route('**/api/projects/*', (route) => (route.request().method() === 'PUT' ? route.abort() : route.continue()));
    await page.getByTestId('save').click();
    await expect(page.getByTestId('save-error')).toBeVisible();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'error');
    expect((await appState(page)).dirty).toBe(true); // never reported as saved
  });
});
