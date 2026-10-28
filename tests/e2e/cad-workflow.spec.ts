import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { appState, clickPlan, clickWall, dragPlan, FIXTURE_DIR, wallExtents, wallMaterial } from './helpers.ts';

const SKY_BLUE = '#87B4D8';
const TERRACOTTA = '#C4553B';

test.describe('DXF import -> verified plan -> editable 3D house -> interior design -> persistence', () => {
  test('full workflow on the reference drawing, including a drafting error that must be corrected', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const fixture = `${FIXTURE_DIR}house-gap.dxf`;
    const original = readFileSync(fixture);

    // 1. create a project through the UI
    await page.goto('/?e2e=1');
    await page.waitForFunction(() => window.__BUILDVIEW__?.getState().loadState === 'ready');
    await page.getByTestId('project-menu').click();
    await page.getByTestId('new-blank').click();
    await expect(page.getByTestId('project-name')).toHaveText('Untitled house');
    await expect.poll(async () => (await appState(page)).mode).toBe('build');
    const projectId = (await appState(page)).project!.id;
    expect((await appState(page)).document.walls).toHaveLength(0);

    // 2. upload the DXF (it has a 300 mm gap in the north wall)
    await page.getByTestId('left-tab-import').click();
    await expect(page.getByTestId('capabilities')).toContainText('DXF supported');
    await expect(page.getByTestId('capabilities')).toContainText('DWG not available');
    await page.getByTestId('import-file').setInputFiles(fixture);
    await expect(page.getByTestId('import-status').first()).toHaveAttribute('data-status', 'succeeded', { timeout: 30_000 });

    // 3. units must be confirmed before anything is recognised
    await expect(page.getByTestId('detected-units')).toContainText('millimetres');
    await expect(page.getByTestId('recognition-summary')).toHaveCount(0);
    await page.getByTestId('confirm-units').click();
    await expect(page.getByTestId('drawing-size')).toContainText('9.000 m × 7.000 m');

    // 4. inspect layers, unsupported entities and the recognition preview
    await expect(page.getByTestId('layer-A-WALL')).toHaveValue('wall');
    await expect(page.getByTestId('layer-A-DOOR')).toHaveValue('door');
    await expect(page.getByTestId('layer-A-GLAZ')).toHaveValue('window');
    await expect(page.getByTestId('layer-A-ANNO')).toHaveValue('ignore');
    await expect(page.getByTestId('unsupported-list')).toContainText('SPLINE');
    await expect(page.getByTestId('rec-walls')).toHaveText('6');
    await expect(page.getByTestId('rec-openings')).toHaveText('4');
    await expect(page.getByTestId('rec-rooms')).toHaveText('2'); // the gap stops the north-east room closing
    await page.getByTestId('apply-import').click();

    // 5. review recognised walls in the 2D plan at the right scale
    const doc0 = (await appState(page)).document;
    expect(doc0.walls).toHaveLength(6);
    expect(doc0.walls.every((w) => w.sourceHandles.length > 0)).toBe(true);
    expect(doc0.sources[0]).toMatchObject({ confirmedUnit: 'mm', toMetres: 0.001, sha256: createHash('sha256').update(original).digest('hex') });
    await expect(page.locator('[data-testid=plan-svg] polygon[data-kind=wall]')).toHaveCount(6);
    await expect(page.locator('[data-testid=plan-svg] [data-kind=opening]')).toHaveCount(4);
    const lengths = doc0.walls.map((w) => Math.round(Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) * 1000) / 1000).sort((a, b) => a - b);
    expect(lengths).toEqual([4, 7, 7, 7, 8.7, 9]);

    // 6. the validation engine flags the gap as critical and blocks 3D generation
    await expect(page.getByTestId('count-critical')).toHaveText('1 critical');
    await expect(page.locator('[data-testid=issue][data-code=wall-gap]')).toContainText('300 mm');
    await page.getByTestId('generate-3d').click();
    await expect(page.getByTestId('generate-blocked')).toBeVisible();
    expect((await appState(page)).mode).toBe('build');
    await expect(page.getByTestId('mode-design')).toBeDisabled();

    // 7. correct the issue in the plan: select the north wall and drag its loose end onto the corner (endpoint snap)
    const north = doc0.walls.find((w) => Math.abs(w.start.y - 3.5) < 1e-6 && Math.abs(w.end.y - 3.5) < 1e-6)!;
    expect(north.start.x).toBeCloseTo(4.2);
    await clickPlan(page, 0, 3.5);
    await page.getByTestId('right-tab-inspector').click();
    await expect(page.getByTestId('wall-id')).toHaveText(north.id);
    await dragPlan(page, [4.2, 3.5], [4.46, 3.5]); // released within the snap radius of the corner at x = 4.5
    const fixedNorth = (await appState(page)).document.walls.find((w) => w.id === north.id)!;
    expect(fixedNorth.start).toEqual({ x: 4.5, y: 3.5 }); // snapped exactly onto the corner, no residual error
    expect(fixedNorth.verificationStatus).toBe('reviewed');

    // 8. re-validate: gap is gone; detect the now-closed third room; review everything
    await page.getByTestId('right-tab-issues').click();
    await expect(page.getByTestId('count-critical')).toHaveText('0 critical');
    await page.getByTestId('left-tab-tools').click();
    await page.getByTestId('detect-rooms').click();
    expect((await appState(page)).document.rooms).toHaveLength(3);
    await page.getByTestId('mark-all-reviewed').click();
    await expect(page.locator('[data-testid=issue][data-code=unreviewed-elements]')).toHaveCount(0);

    // 9. approve and generate the 3D house
    await page.getByTestId('generate-3d').click();
    await expect.poll(async () => (await appState(page)).mode).toBe('design');
    expect((await appState(page)).document.approval.status).toBe('approved');
    await page.waitForFunction(() => window.__BUILDVIEW__!.roomMeshes().length === 6); // 3 floors + 3 ceilings

    // actual openings are cut into the generated walls (not doors drawn in front of solid walls)
    const doc1 = (await appState(page)).document;
    const southWall = doc1.walls.find((w) => Math.abs(w.start.y + 3.5) < 1e-6 && Math.abs(w.end.y + 3.5) < 1e-6)!;
    const southDoor = doc1.openings.find((o) => o.wallId === southWall.id)!;
    expect(southDoor.kind).toBe('door');
    expect(await page.evaluate((id) => window.__BUILDVIEW__!.wallSegments(id), southWall.id)).toBe(3); // left solid, lintel, right solid
    const northSegments = await page.evaluate((id) => window.__BUILDVIEW__!.wallSegments(id), north.id);
    expect(northSegments).toBe(4); // window: left, below, above, right

    // 10. select the living-room's west wall in 3D, blue -> red, verify materials and dimensions
    const west = doc1.walls.find((w) => Math.abs(w.start.x + 4.5) < 1e-6 && Math.abs(w.end.x + 4.5) < 1e-6)!;
    await page.waitForFunction((id) => window.__BUILDVIEW__!.wallScreenPoint(id) !== null, west.id);
    await clickWall(page, west.id);
    await expect(page.getByTestId('wall-id')).toHaveText(west.id);
    const props = page.getByTestId('properties-panel');
    const before = { extents: await wallExtents(page, west.id), length: await props.getByTestId('wall-length').textContent(), neighbour: await wallMaterial(page, north.id) };
    await props.getByRole('button', { name: /^Sky Blue/ }).click();
    await expect.poll(async () => (await wallMaterial(page, west.id))?.color).toBe(SKY_BLUE);
    await props.getByRole('button', { name: /^Terracotta Red/ }).click();
    await expect.poll(async () => (await wallMaterial(page, west.id))?.color).toBe(TERRACOTTA);
    expect(await wallExtents(page, west.id)).toEqual(before.extents);
    await expect(props.getByTestId('wall-length')).toHaveText(before.length!);
    expect(await wallMaterial(page, north.id)).toEqual(before.neighbour);
    expect((await appState(page)).document.approval.status).toBe('approved'); // paint does not invalidate geometry approval

    // 11. save, then reload
    await page.getByTestId('save').click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    const savedDoc = (await appState(page)).document;
    await page.reload();
    await page.waitForFunction(() => window.__BUILDVIEW__?.getState().loadState === 'ready');
    await page.waitForFunction((id) => window.__BUILDVIEW__!.wallMaterial(id) != null, west.id);

    // 12. geometry and material persisted exactly; source drawing preserved byte-for-byte
    const reloaded = (await appState(page)).document as unknown as typeof savedDoc;
    expect(reloaded.walls).toEqual(savedDoc.walls);
    expect(reloaded.openings).toEqual(savedDoc.openings);
    expect(reloaded.rooms).toEqual(savedDoc.rooms);
    expect(reloaded.surfaces[west.id]?.color).toBe(TERRACOTTA);
    expect(reloaded.approval.status).toBe('approved');
    await expect.poll(async () => (await wallMaterial(page, west.id))?.color).toBe(TERRACOTTA);
    expect(await wallExtents(page, west.id)).toEqual(before.extents);
    const download = await request.get(`http://localhost:4000/api/projects/${projectId}/sources/${reloaded.sources[0]!.sourceId}/file`);
    expect(Buffer.compare(Buffer.from(await download.body()), original)).toBe(0);

    // the 2D plan reads the same model after reload
    await page.getByTestId('mode-build').click();
    await expect(page.locator('[data-testid=plan-svg] polygon[data-kind=wall]')).toHaveCount(6);
    expect(errors).toEqual([]);
  });

  test('a drawing without units makes the architect choose them; a wrong choice is visible, not silently fixed', async ({ page, request }) => {
    const res = await request.post('http://localhost:4000/api/projects', { data: { name: 'No units', template: 'blank' } });
    const project = await res.json();
    await page.goto(`/?project=${project.id}&e2e=1`);
    await page.waitForFunction(() => window.__BUILDVIEW__?.getState().loadState === 'ready');
    await page.getByTestId('left-tab-import').click();
    await page.getByTestId('import-file').setInputFiles(`${FIXTURE_DIR}house-missing-units.dxf`);
    await expect(page.getByTestId('import-status').first()).toHaveAttribute('data-status', 'succeeded', { timeout: 30_000 });
    await expect(page.getByTestId('detected-units')).toContainText('scale is unknown');
    await expect(page.getByTestId('recognition-summary')).toHaveCount(0);
    await page.getByTestId('unit-select').selectOption('m');
    await page.getByTestId('confirm-units').click();
    await expect(page.getByTestId('drawing-size')).toContainText('9000.000 m × 7000.000 m'); // obviously wrong: the architect sees it
    await page.getByTestId('unit-select').selectOption('mm');
    await page.getByTestId('confirm-units').click();
    await expect(page.getByTestId('drawing-size')).toContainText('9.000 m × 7.000 m');
  });

  test('DWG upload is accepted but reported as unavailable, and the original is kept', async ({ page, request }) => {
    const project = await (await request.post('http://localhost:4000/api/projects', { data: { name: 'DWG', template: 'blank' } })).json();
    await page.goto(`/?project=${project.id}&e2e=1`);
    await page.waitForFunction(() => window.__BUILDVIEW__?.getState().loadState === 'ready');
    await page.getByTestId('left-tab-import').click();
    await page.getByTestId('import-file').setInputFiles(`${FIXTURE_DIR}fake.dwg`);
    await expect(page.getByTestId('import-status').first()).toHaveAttribute('data-status', 'failed', { timeout: 30_000 });
    await expect(page.getByTestId('import-error').first()).toContainText('converter');
    const imports = await (await request.get(`http://localhost:4000/api/projects/${project.id}/imports`)).json();
    expect(imports[0].errorCode).toBe('dwg_unavailable');
  });

  test('hostile uploads are rejected with a clear message', async ({ page, request }) => {
    const project = await (await request.post('http://localhost:4000/api/projects', { data: { name: 'Hostile', template: 'blank' } })).json();
    await page.goto(`/?project=${project.id}&e2e=1`);
    await page.waitForFunction(() => window.__BUILDVIEW__?.getState().loadState === 'ready');
    await page.getByTestId('left-tab-import').click();
    await page.getByTestId('import-file').setInputFiles({ name: 'plan.dxf', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ\u0090\u0000 not a drawing') });
    await expect(page.getByRole('alert').first()).toContainText('does not look like a DXF');
    expect(await (await request.get(`http://localhost:4000/api/projects/${project.id}/imports`)).json()).toEqual([]);
  });
});
