import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startFixtureServer, type FixtureServer } from '../helpers/fixture-server';
import { makeTmpDir } from '../helpers/tmp';
import { cdnSite, staticSite } from '../fixtures/static-site';
import { spaSite } from '../fixtures/spa-site';
import { api, launchPackaged, runJobInApp, type AppRun } from '../e2e/launch';
import pkg from '../../package.json';

let cdn: FixtureServer;
let site: FixtureServer;
let spa: FixtureServer;
beforeAll(async () => {
  cdn = await startFixtureServer(() => cdnSite());
  site = await startFixtureServer(() => staticSite(cdn.url));
  spa = await startFixtureServer(() => spaSite());
});
afterAll(async () => {
  await spa.close();
  await site.close();
  await cdn.close();
});

async function withPackaged<T>(profile: string, fn: (run: AppRun) => Promise<T>): Promise<T> {
  const run = await launchPackaged(profile);
  try {
    return await fn(run);
  } finally {
    await run.app.close();
  }
}

describe('Trawler packaged app (release/win-unpacked)', () => {
  it('is really the packaged app', async () => {
    await withPackaged(await makeTmpDir('pk-profile'), async (run) => {
      expect(await run.app.evaluate(({ app }) => app.isPackaged)).toBe(true);
      const appPath = await run.app.evaluate(({ app }) => app.getAppPath());
      expect(path.basename(appPath)).toBe('app.asar');
      expect(await run.page.title()).toBe('Trawler');
    });
  });

  it('loads the UI and passes the trust check', async () => {
    const profile = await makeTmpDir('pk-profile');
    await withPackaged(profile, async (run) => {
      await run.page.getByRole('button', { name: 'Analyze' }).waitFor({ timeout: 30000 });
      const info = await api(run, 'appInfo');
      expect(info.version).toBe(pkg.version);
      expect(path.resolve(info.userDataDir)).toBe(path.resolve(profile));
    });
  });

  it('downloads a static template', async () => {
    await withPackaged(await makeTmpDir('pk-profile'), async (run) => {
      const out = await makeTmpDir('pk-out');
      const { finished } = await runJobInApp(run, {
        kind: 'download',
        seedUrl: `${site.url}/html/index.html`,
        outputDir: out,
        settings: { mode: 'static', retries: 0 },
      });
      expect(finished.result.status).toBe('done_with_errors'); // the fixture's missing.png is a real 404
      await fs.access(path.join(out, '_trawler', 'manifest.json'));
    });
  });

  it('downloads a JS-rendered template with the hidden browser', async () => {
    await withPackaged(await makeTmpDir('pk-profile'), async (run) => {
      const out = await makeTmpDir('pk-out');
      const { finished } = await runJobInApp(run, {
        kind: 'download',
        seedUrl: `${spa.url}/app/`,
        outputDir: out,
        settings: { mode: 'js', retries: 0 },
      });
      expect(finished.result.status).toBe('done');
      expect(finished.result.mode).toBe('js');
    });
  });

  it('shows the same UI as the source build', async () => {
    await withPackaged(await makeTmpDir('pk-profile'), async (run) => {
      await run.page.getByText('Paste a link').waitFor({ timeout: 30000 });
      expect(await run.page.evaluate(() => document.documentElement.dataset.palette)).toBe('ember');
    });
  });

  it('keeps its data in TrawlerData beside a portable exe', async () => {
    const portableDir = await makeTmpDir('pk-portable');
    const run = await launchPackaged(undefined, { PORTABLE_EXECUTABLE_DIR: portableDir, PORTABLE_EXECUTABLE_APP_FILENAME: 'trawler' });
    try {
      const info = await api(run, 'appInfo');
      expect(path.resolve(info.userDataDir)).toBe(path.resolve(portableDir, 'TrawlerData'));
    } finally {
      await run.app.close();
    }
  });
});
