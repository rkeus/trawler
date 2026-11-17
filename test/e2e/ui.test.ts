import fs from 'node:fs/promises';
import path from 'node:path';
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

async function withUi<T>(fn: (run: AppRun, profile: string) => Promise<T>, prepare?: (profile: string) => Promise<void>): Promise<T> {
  const profile = await makeTmpDir('e2e-profile');
  await prepare?.(profile);
  const run = await launchApp(profile);
  try {
    await run.page.getByRole('button', { name: 'Analyze' }).waitFor({ timeout: 30000 });
    return await fn(run, profile);
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
      await page.getByRole('button', { name: 'Download with these settings' }).waitFor({ timeout: 60000 });
      expect(await page.getByText('Pages -', { exact: false }).first().textContent()).toMatch(/Pages - \d+/);
      await page.getByRole('button', { name: 'Back' }).click();
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
      await page.getByRole('button', { name: 'New download' }).click();
      const row = page.getByRole('list', { name: 'Recent jobs' }).getByRole('listitem').first();
      expect(await row.textContent()).toContain('pages');
    });
  });

  it('downloads straight from the analysis screen, reusing its pages', async () => {
    await withUi(async ({ app, page }) => {
      const out = await makeTmpDir('e2e-out');
      await app.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
      }, out);
      await page.getByLabel('Template URL').fill(`${site.url}/html/index.html`);
      await page.getByRole('button', { name: 'Analyze' }).click();
      await page.getByRole('button', { name: 'Download with these settings' }).waitFor({ timeout: 60000 });
      await page.getByRole('button', { name: 'Choose output folder' }).click();
      await page.getByText(out, { exact: false }).first().waitFor();
      await page.getByRole('button', { name: 'Download with these settings' }).click();
      await page.getByRole('heading', { name: /^Done/ }).waitFor({ timeout: 90000 });
      for (const name of ['Run preview', 'Open folder', 'Open report', 'New download']) {
        await page.getByRole('button', { name }).waitFor();
      }
      await fs.access(path.join(out, '_trawler', 'report.json'));
    });
  });

  it('saves settings and the accent, and keeps them across a restart', async () => {
    const profile = await makeTmpDir('e2e-profile');
    for (const second of [false, true]) {
      const run = await launchApp(profile);
      try {
        await run.page.getByRole('button', { name: 'Analyze' }).waitFor({ timeout: 30000 });
        await run.page.getByRole('button', { name: 'Settings' }).click();
        if (!second) {
          await run.page.getByLabel('Max depth').fill('3');
          await run.page.getByRole('button', { name: 'Moss' }).click();
          await run.page.getByRole('button', { name: 'Save' }).click();
          await run.page.getByText('Saved.').waitFor();
          expect(JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'))).toEqual({ maxDepth: 3 });
          expect(JSON.parse(await fs.readFile(path.join(profile, 'app-state.json'), 'utf8')).palette).toBe('moss');
        } else {
          expect(await run.page.getByLabel('Max depth').inputValue()).toBe('3');
          expect(await run.page.evaluate(() => document.documentElement.dataset.palette)).toBe('moss');
        }
      } finally {
        await run.app.close();
      }
    }
  });

  it('shows a damaged store as a warning on the start screen', async () => {
    await withUi(
      async ({ page }) => {
        await page.getByText(/history\.json was damaged/).waitFor();
        await page.getByRole('button', { name: 'Dismiss' }).click();
        await page.getByText(/history\.json was damaged/).waitFor({ state: 'detached' });
      },
      async (profile) => {
        await fs.writeFile(path.join(profile, 'history.json'), '{not json');
      },
    );
  });
});
