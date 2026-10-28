import { expect, test, type Page } from '@playwright/test';
import { appState, clickPlan, clickWall, createProject, dragPlan, openProject, wallExtents, wallMaterial } from './helpers.ts';

const len = (w: { start: { x: number; y: number }; end: { x: number; y: number } }) => Math.round(Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) * 1e4) / 1e4;

/** Draws a closed 4 x 3 m room with the Wall tool using real clicks on the plan canvas. */
async function drawRoom(page: Page) {
  await page.getByTestId('plan-tool-wall').click();
  const pts: Array<[number, number]> = [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5], [-2, -1.5]];
  for (const [x, y] of pts) await clickPlan(page, x, y);
  await page.keyboard.press('Escape');
  await page.getByTestId('plan-tool-select').click();
}

test.describe('2D plan editor with live 3D synchronisation', () => {
  test.beforeEach(async ({ page, request }) => {
    const project = await createProject(request, 'Plan editing', 'blank');
    await openProject(page, project.id, 'build');
    await page.getByTestId('plan-svg').waitFor();
    await page.waitForFunction(() => window.__BUILDVIEW__!.planToClient(0, 0) !== null);
  });

  test('draws walls with snapping, detects the room and edits real dimensions', async ({ page }) => {
    await drawRoom(page);
    const doc = (await appState(page)).document;
    expect(doc.walls).toHaveLength(4);
    expect(doc.walls.map(len)).toEqual([4, 3, 4, 3]); // exact: snapped to the 0.1 m grid / endpoints, nothing rounded elsewhere
    expect(doc.walls.every((w) => w.thicknessM === 0.2 && w.heightM === 2.8)).toBe(true);
    expect(doc.surfaces[doc.walls[0]!.id]).toBeDefined(); // default material created with the wall
    await page.getByTestId('detect-rooms').click();
    const rooms = (await appState(page)).document.rooms;
    expect(rooms).toHaveLength(1);
    await clickPlan(page, 0, 0);
    await expect(page.getByTestId('room-area')).toHaveText('10.64 m²'); // (4 - 0.2) x (3 - 0.2)

    // numeric length edit in the inspector changes the model and is undoable
    await clickPlan(page, 0, -1.5);
    await page.getByTestId('field-length').fill('5');
    await page.getByTestId('field-length').press('Enter');
    const first = (await appState(page)).document.walls[0]!;
    expect(len(first)).toBe(5);
    await page.keyboard.press('Control+z');
    expect(len((await appState(page)).document.walls[0]!)).toBe(4);
  });

  test('keeps 2D and 3D in sync: selection, openings, deletion and undo', async ({ page }) => {
    await drawRoom(page);
    await page.getByTestId('detect-rooms').click();
    await page.getByRole('radio', { name: '2D + 3D' }).click();
    await page.waitForFunction(() => (window.__BUILDVIEW__?.frames() ?? 0) > 0);
    const [south, east, north, west] = (await appState(page)).document.walls;
    const target = east; // far wall from the default 3D camera, so it is visible and clickable
    void west;

    // place a door and a window with the plan tools
    await page.getByTestId('plan-tool-door').click();
    await clickPlan(page, 0, 1.5);
    await page.getByTestId('plan-tool-window').click();
    await clickPlan(page, 2, 0);
    await page.getByTestId('plan-tool-select').click();
    let doc = (await appState(page)).document;
    expect(doc.openings.map((o) => [o.kind, o.wallId])).toEqual([['door', north!.id], ['window', east!.id]]);
    // the generated 3D walls contain real cut-outs (door: 3 boxes, window: 4 boxes; solid wall: 1)
    await expect.poll(() => page.evaluate((id) => window.__BUILDVIEW__!.wallSegments(id), north!.id)).toBe(3);
    await expect.poll(() => page.evaluate((id) => window.__BUILDVIEW__!.wallSegments(id), east!.id)).toBe(4);
    expect(await page.evaluate((id) => window.__BUILDVIEW__!.wallSegments(id), south!.id)).toBe(1);

    // drag the door along its wall in 2D; the 3D cut-out moves with it (left solid segment grows)
    const door = doc.openings[0]!;
    const widthBefore = (await wallExtents(page, north!.id))!;
    const northWall = doc.walls.find((w) => w.id === north!.id)!;
    await dragPlan(page, [northWall.start.x - door.offsetM, 1.5], [-1.0, 1.5]); // the north wall runs east -> west here
    expect((await appState(page)).document.openings.find((o) => o.id === door.id)!.offsetM).toBeCloseTo(northWall.start.x + 1.0, 1);
    doc = (await appState(page)).document;
    const moved = doc.openings.find((o) => o.id === door.id)!;
    expect(moved.offsetM).not.toBe(door.offsetM);
    expect(moved.offsetM - moved.widthM / 2).toBeGreaterThanOrEqual(0); // never leaves the wall
    expect(await wallExtents(page, north!.id)).toEqual(widthBefore); // moving an opening never changes the wall's size
    await dragPlan(page, [-1.0, 1.5], [-9, 1.5]); // far beyond the wall end: clamped
    const clamped = (await appState(page)).document.openings.find((o) => o.id === door.id)!;
    expect(clamped.offsetM).toBeCloseTo(len(northWall) - clamped.widthM / 2, 4); // stops exactly at the far wall end
    expect((await appState(page)).dirty).toBe(true);

    // select a wall in 2D -> highlighted in the model state shared with 3D; select in 3D -> highlighted in 2D
    await clickPlan(page, 0, -1.5);
    expect((await appState(page)).selection).toEqual({ kind: 'wall', ids: [south!.id] });
    await expect(page.locator(`[data-testid=plan-svg] polygon[data-id=${south!.id}]`)).toHaveAttribute('fill', '#f0c070');
    await page.getByTestId('plan-tool-select').click();
    await page.keyboard.press('Escape');
    await page.waitForFunction((id) => window.__BUILDVIEW__!.wallScreenPoint(id) !== null, target!.id);
    await clickWall(page, target!.id);
    expect((await appState(page)).selection).toEqual({ kind: 'wall', ids: [target!.id] });
    await expect(page.locator(`[data-testid=plan-svg] polygon[data-id=${target!.id}]`)).toHaveAttribute('fill', '#f0c070');

    // delete the selected wall: gone from both views, the open room boundary is reported; undo restores it
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-testid=plan-svg] polygon[data-kind=wall]')).toHaveCount(3);
    expect(await wallMaterial(page, target!.id)).toBeNull();
    await page.getByTestId('right-tab-issues').click();
    await expect(page.getByTestId('count-warning')).not.toHaveText('0 warnings'); // loose wall ends and an open room boundary
    await expect(page.locator('[data-testid=issue][data-code=orphan-material]')).toHaveCount(1); // the wall's paint is kept, and reported
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-testid=plan-svg] polygon[data-kind=wall]')).toHaveCount(4);
    await expect.poll(async () => (await wallMaterial(page, target!.id))?.color).toBe('#F1EEE6');
  });

  test('display units change the text, never the geometry', async ({ page }) => {
    await drawRoom(page);
    const before = JSON.stringify((await appState(page)).document.walls);
    await clickPlan(page, 0, -1.5);
    await expect(page.getByTestId('field-length')).toHaveValue('4');
    await page.getByTestId('display-unit').selectOption('mm').catch(async () => {
      await page.getByTestId('left-tab-tools').click();
      await page.getByTestId('display-unit').selectOption('mm');
    });
    await expect(page.getByTestId('field-length')).toHaveValue('4000');
    await page.getByTestId('display-unit').selectOption('ft-in');
    await expect(page.getByTestId('field-length')).toHaveValue('13′ 1 1/2″');
    expect(JSON.stringify((await appState(page)).document.walls)).toBe(before);
    // typing in feet and inches sets the exact metric value
    await page.getByTestId('field-length').fill(`10' 0"`);
    await page.getByTestId('field-length').press('Enter');
    const edited = (await appState(page)).document.walls[0]!;
    expect(len(edited)).toBeCloseTo(3.048, 4);
  });

  test('measure tool reports distances in the chosen unit without touching the model', async ({ page }) => {
    await drawRoom(page);
    const before = JSON.stringify((await appState(page)).document);
    await page.getByTestId('plan-tool-measure').click();
    await clickPlan(page, -2, -1.5);
    await clickPlan(page, 2, 1.5);
    await expect(page.getByTestId('measurement')).toHaveText('5.000 m');
    expect(JSON.stringify((await appState(page)).document)).toBe(before);
  });

  test('walkthrough: first-person movement is stopped by walls', async ({ page }) => {
    await drawRoom(page);
    await page.getByTestId('detect-rooms').click();
    await page.getByTestId('mode-experience').click();
    await expect.poll(async () => (await appState(page)).mode).toBe('experience');
    await expect(page.getByTestId('walk-hint')).toBeVisible();
    await page.waitForFunction(() => (window.__BUILDVIEW__?.frames() ?? 0) > 0);
    await page.locator('canvas').click({ position: { x: 20, y: 20 } });
    const start = await page.evaluate(() => window.__BUILDVIEW__!.walker());
    expect(Math.abs(start.x)).toBeLessThan(0.01);
    expect(Math.abs(start.y)).toBeLessThan(0.01);
    await page.keyboard.down('w'); // initial heading is plan -y (towards the south wall at y = -1.5, inner face -1.4)
    await expect.poll(async () => (await page.evaluate(() => window.__BUILDVIEW__!.walker())).y, { timeout: 30_000 }).toBeLessThan(-0.8);
    await page.waitForTimeout(6000); // keep pushing against the wall
    await page.keyboard.up('w');
    const end = await page.evaluate(() => window.__BUILDVIEW__!.walker());
    expect(end.y).toBeGreaterThan(-1.4 + 0.2); // body radius 0.25 keeps the walker inside the inner wall face
    expect(end.y).toBeLessThan(-0.8);
    expect(Math.abs(end.x)).toBeLessThan(0.3);
    // editing is disabled in this mode
    expect((await appState(page)).selection).toBeNull();
  });
});


