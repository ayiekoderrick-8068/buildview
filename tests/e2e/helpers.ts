import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Project } from '@buildview/shared';
import type { TestState } from '../../apps/web/src/debug.ts';

/** Creates a fresh sample project through the real API so each test is isolated. */
export async function createProject(request: APIRequestContext, name = 'E2E project'): Promise<Project> {
  const res = await request.post('http://localhost:4000/api/projects', { data: { name } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Project;
}

export async function openProject(page: Page, id: string) {
  await page.goto(`/?project=${id}&e2e=1`);
  await page.waitForFunction(() => window.__BUILDVIEW__?.getState().loadState === 'ready');
  // The WebGL scene is ready once the north wall material exists in the registry.
  await page.waitForFunction(() => window.__BUILDVIEW__?.wallMaterial('wall-north') != null);
  await page.waitForFunction(() => window.__BUILDVIEW__?.frames() !== undefined && window.__BUILDVIEW__.frames() > 0);
}

export const wallMaterial = (page: Page, id: string) =>
  page.evaluate((wallId) => window.__BUILDVIEW__!.wallMaterial(wallId), id);

export const wallExtents = (page: Page, id: string) =>
  page.evaluate((wallId) => window.__BUILDVIEW__!.wallExtents(wallId), id);

export const furnitureItem = (state: TestState, id: string) => state.document.furniture.find((f) => f.id === id)!;

export const appState =(page: Page): Promise<TestState> => page.evaluate(() => window.__BUILDVIEW__!.getState());

/** Clicks a wall at its real projected screen position. */
export async function clickWall(page: Page, id: string, modifiers: Array<'Shift'> = []) {
  const point = await page.evaluate((wallId) => window.__BUILDVIEW__!.wallScreenPoint(wallId), id);
  expect(point, `screen point for ${id}`).not.toBeNull();
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(point!.x, point!.y);
  for (const m of modifiers) await page.keyboard.up(m);
}
