import { test } from '@playwright/test';
import { clickWall, createProject, openProject } from './helpers.ts';

/** Regenerates docs/screenshots from the running app. Only runs with `npm run screenshots`. */
test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to regenerate documentation screenshots');

const out = (name: string) => `docs/screenshots/${name}.png`;

test('documentation screenshots', async ({ page, request }) => {
  const project = await createProject(request, 'Sample living room');
  await openProject(page, project.id);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out('01-studio-default') });

  await clickWall(page, 'wall-east');
  await page.getByTestId('properties-panel').getByRole('button', { name: /^Sky Blue/ }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: out('02-wall-selected-painted') });

  await page.getByTestId('tool-lighting').click();
  await page.getByRole('radio', { name: 'Warm evening' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: out('03-evening-lighting') });
  await page.getByRole('radio', { name: 'Daylight' }).click();

  await page.getByTestId('tool-furniture').click();
  await page.getByTestId('furniture-item-sofa-main').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: out('04-furniture-selected') });

  await page.getByTestId('strip-plan').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out('05-plan-view') });

  await page.getByTestId('strip-3d').click();
  await page.getByTestId('camera-fit').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out('06-overview') });
});
