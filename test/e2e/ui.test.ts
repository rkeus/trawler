import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../helpers/fixture-server';
import { makeTmpDir } from '../helpers/tmp';
import { cdnSite, staticSite } from '../fixtures/static-site';
import { launchApp, type AppRun } from './launch';

let cdn: FixtureServer;
let site: FixtureServer;
beforeAll(async () => {
  cdn = await startFixtureServer(() => cdnSite());
  site = await startFixtureServer(() => staticSite(cdn.url));
});
afterAll(async () => {
  await site.close();
  await cdn.close();
});

async function withUi<T>(fn: (run: AppRun) => Promise<T>): Promise<T> {
  const run = await launchApp(await makeTmpDir('e2e-profile'));
  try {
    await run.page.getByRole('button', { name: 'Analyze' }).waitFor({ timeout: 30000 });
    return await fn(run);
  } finally {
    await run.app.close();
  }
}

describe('Trawler UI (real Electron)', () => {
  it('starts with the Ember palette, the dark theme and the welcome steps', async () => {
    await withUi(async ({ page }) => {
      expect(await page.evaluate(() => ({ ...document.documentElement.dataset }))).toMatchObject({ theme: 'dark', palette: 'ember' });
      await page.getByText('Paste a link').waitFor();
      expect(await page.title()).toBe('Trawler');
    });
  });

  it('analyzes a template from the UI and shows the result', async () => {
    await withUi(async ({ page }) => {
      await page.getByLabel('Template URL').fill(`${site.url}/html/index.html`);
      await page.getByRole('button', { name: 'Analyze' }).click();
      await page.getByRole('heading', { name: 'Done' }).waitFor({ timeout: 60000 });
      await page.getByRole('button', { name: 'Back to start' }).click();
      await page.getByRole('list', { name: 'Recent jobs' }).waitFor();
      expect(await page.getByRole('list', { name: 'Recent jobs' }).textContent()).toContain('127.0.0.1');
    });
  });

  it('downloads into a folder chosen in the dialog', async () => {
    await withUi(async ({ app, page }) => {
      const out = await makeTmpDir('e2e-out');
      // the native folder dialog cannot be driven: answer it from the main process
      await app.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
      }, out);
      await page.getByLabel('Template URL').fill(`${site.url}/html/index.html`);
      await page.getByRole('button', { name: 'Choose output folder' }).click();
      await page.getByText(out, { exact: false }).first().waitFor();
      await page.getByRole('button', { name: 'Download' }).click();
      await page.getByRole('heading', { name: /^Done/ }).waitFor({ timeout: 90000 });
      await page.getByRole('button', { name: 'Back to start' }).click();
      const row = page.getByRole('list', { name: 'Recent jobs' }).getByRole('listitem').first();
      expect(await row.textContent()).toContain('pages');
    });
  });
});
