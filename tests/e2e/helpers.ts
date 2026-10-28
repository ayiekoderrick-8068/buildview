import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Project } from '@buildview/shared';
import type { TestState } from '../../apps/web/src/debug.ts';

/** Creates a fresh project through the real API so each test is isolated. */
export async function createProject(request: APIRequestContext, name = 'E2E project', template: 'sample' | 'blank' = 'sample'): Promise<Project> {
  const res = await request.post('http://localhost:4000/api/projects', { data: { name, template } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Project;
}

export async function openProject(page: Page, id: string, mode?: 'build' | 'design' | 'experience') {
  await page.goto(`/?project=${id}&e2e=1${mode ? `&mode=${mode}` : ''}`);
  await page.waitForFunction(() => window.__BUILDVIEW__?.getState().loadState === 'ready');
  if (!mode || mode !== 'build') {
    // 3D scene is ready once the first wall material exists in the registry
    await page.waitForFunction(() => (window.__BUILDVIEW__?.getState().document.walls.length ?? 0) === 0 || window.__BUILDVIEW__?.wallMaterial(window.__BUILDVIEW__.getState().document.walls[0]!.id) != null);
    await page.waitForFunction(() => (window.__BUILDVIEW__?.frames() ?? 0) > 0);
  }
}

export const wallMaterial = (page: Page, id: string) => page.evaluate((wallId) => window.__BUILDVIEW__!.wallMaterial(wallId), id);
export const wallExtents = (page: Page, id: string) => page.evaluate((wallId) => window.__BUILDVIEW__!.wallExtents(wallId), id);
export const furnitureItem = (state: TestState, id: string) => state.document.furniture.find((f) => f.id === id)!;
export const appState = (page: Page): Promise<TestState> => page.evaluate(() => window.__BUILDVIEW__!.getState());

/** Clicks a wall in the 3D view at a real pixel where the ray hits that wall. */
export async function clickWall(page: Page, id: string, modifiers: Array<'Shift'> = []) {
  const point = await page.evaluate((wallId) => window.__BUILDVIEW__!.wallScreenPoint(wallId), id);
  expect(point, `screen point for ${id}`).not.toBeNull();
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(point!.x, point!.y);
  for (const m of modifiers) await page.keyboard.up(m);
}

/** Click a plan coordinate (metres) in the 2D editor. */
export async function clickPlan(page: Page, x: number, y: number, opts: { shift?: boolean } = {}) {
  const p = await page.evaluate(([px, py]) => window.__BUILDVIEW__!.planToClient(px!, py!), [x, y]);
  expect(p, 'plan view ready').not.toBeNull();
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.click(p!.x, p!.y);
  if (opts.shift) await page.keyboard.up('Shift');
}

export async function dragPlan(page: Page, from: [number, number], to: [number, number]) {
  const a = await page.evaluate(([px, py]) => window.__BUILDVIEW__!.planToClient(px!, py!), from);
  const b = await page.evaluate(([px, py]) => window.__BUILDVIEW__!.planToClient(px!, py!), to);
  await page.mouse.move(a!.x, a!.y);
  await page.mouse.down();
  await page.mouse.move((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, { steps: 4 });
  await page.mouse.move(b!.x, b!.y, { steps: 6 });
  await page.mouse.up();
}

export const FIXTURE_DIR = new URL('../fixtures/dxf/', import.meta.url).pathname;
