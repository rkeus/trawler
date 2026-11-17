import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startFixtureServer, type FixtureServer } from '../helpers/fixture-server';
import { makeTmpDir } from '../helpers/tmp';
import { cdnSite, staticSite } from '../fixtures/static-site';
import { api, launchApp, runJobInApp, type AppRun } from './launch';

let cdn: FixtureServer;
let site: FixtureServer;
let slow: FixtureServer;
beforeAll(async () => {
  cdn = await startFixtureServer(() => cdnSite());
  site = await startFixtureServer(() => staticSite(cdn.url));
  slow = await startFixtureServer(() => ({ '/slow/': { type: 'text/html', body: '<p>slow</p>', delayMs: 15000 } }));
});
afterAll(async () => {
  await slow.close();
  await site.close();
  await cdn.close();
});

async function withApp<T>(userData: string, fn: (run: AppRun) => Promise<T>): Promise<T> {
  const run = await launchApp(userData);
  try {
    return await fn(run);
  } finally {
    await run.app.close();
  }
}

describe('Trawler desktop app (real Electron, API level)', () => {
  it('exposes only the typed API to the page', async () => {
    const profile = await makeTmpDir('e2e-profile');
    await withApp(profile, async (run) => {
      expect(await run.page.title()).toBe('Trawler');
      const probe = await run.page.evaluate(() => ({
        api: typeof (globalThis as any).trawler,
        keys: Object.keys((globalThis as any).trawler).sort(),
        require: typeof (globalThis as any).require,
        process: typeof (globalThis as any).process,
      }));
      expect(probe.api).toBe('object');
      expect(probe.require).toBe('undefined');
      expect(probe.process).toBe('undefined');
      expect(probe.keys).toEqual(expect.arrayContaining(['startJob', 'getSettings', 'onJobEvent', 'onJobFinished']));
      const info = await api(run, 'appInfo');
      expect(path.resolve(info.userDataDir)).toBe(path.resolve(profile));
    });
  });

  it('keeps settings and app state across restarts', async () => {
    const profile = await makeTmpDir('e2e-profile');
    await withApp(profile, async (run) => {
      const snap = await api(run, 'updateSettings', { maxPages: 42 });
      expect(snap.settings.maxPages).toBe(42);
      await api(run, 'updateAppState', { legalNoteAccepted: true });
    });
    expect(JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'))).toEqual({ maxPages: 42 });
    await withApp(profile, async (run) => {
      expect((await api(run, 'getSettings')).settings.maxPages).toBe(42);
      expect((await api(run, 'getAppState')).legalNoteAccepted).toBe(true);
    });
  });

  it('analyzes, downloads with the analysis reused, records history and previews the copy', async () => {
    await withApp(await makeTmpDir('e2e-profile'), async (run) => {
      const seedUrl = `${site.url}/html/index.html`;
      const analysis = await runJobInApp(run, { kind: 'analyze', seedUrl, settings: { retries: 0 } });
      expect(analysis.finished.result.status).toBe('done');
      expect(analysis.finished.result.detection.verdict).toBe('static');
      expect(analysis.finished.result.analysis.pages).toContain(seedUrl);
      expect(analysis.events.some((m) => m.event.type === 'phase' && m.event.phase === 'detecting')).toBe(true);

      const out = await makeTmpDir('e2e-out');
      const before = site.requests.length;
      const download = await runJobInApp(run, { kind: 'download', seedUrl, outputDir: out, settings: { retries: 0 } });
      expect(download.start.usesAnalysisCache).toBe(true);
      expect(download.finished.result.status).toBe('done_with_errors'); // missing.png is a real 404
      expect(download.finished.result.verify.missing).toEqual([]);
      expect(site.requests.slice(before)).not.toContain('/html/about.html');

      const history = await api(run, 'listHistory');
      expect(history.map((e: any) => e.kind)).toEqual(['download', 'analyze']);
      expect(history[0].outputDir).toBe(path.resolve(out));
      expect((await api(run, 'getAppState')).lastOutputDir).toBe(path.resolve(out));

      const preview = await api(run, 'startPreview', path.resolve(out));
      // the preview URL is the output root; find the start page's local path in the manifest
      const manifest = JSON.parse(await fs.readFile(path.join(out, '_trawler', 'manifest.json'), 'utf8'));
      const index = manifest.files.find((f: any) => f.url === seedUrl);
      const res = await fetch(new URL(index.path, preview.url));
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('About');
      await api(run, 'stopPreview');
      expect(await api(run, 'currentPreview')).toBeNull();
    });
  });

  it('runs one job at a time and cancels', async () => {
    await withApp(await makeTmpDir('e2e-profile'), async (run) => {
      const result = await run.page.evaluate(async (seedUrl) => {
        const trawler = (globalThis as any).trawler;
        let resolveDone!: (msg: any) => void;
        const done = new Promise<any>((resolve) => (resolveDone = resolve));
        const off = trawler.onJobFinished((msg: any) => resolveDone(msg));
        const first = await trawler.startJob({ kind: 'analyze', seedUrl, settings: { mode: 'static' } });
        let secondError = '';
        try {
          await trawler.startJob({ kind: 'analyze', seedUrl });
        } catch (err) {
          secondError = String((err as Error).message);
        }
        const current = await trawler.currentJob();
        const cancelled = await trawler.cancelJob(first.jobId);
        const finished = await done;
        off();
        return { secondError, currentId: current?.jobId, firstId: first.jobId, cancelled, status: finished.result.status };
      }, `${slow.url}/slow/`);
      expect(result.secondError).toMatch(/already running/);
      expect(result.currentId).toBe(result.firstId);
      expect(result.cancelled).toBe(true);
      expect(result.status).toBe('cancelled');
      expect(await api(run, 'currentJob')).toBeNull();
    });
  });

  it('reports bad input as a rejected promise with a plain message', async () => {
    await withApp(await makeTmpDir('e2e-profile'), async (run) => {
      const message = await run.page.evaluate(async () => {
        try {
          await (globalThis as any).trawler.openFolder('relative/path');
          return 'no error';
        } catch (err) {
          return (err as Error).message;
        }
      });
      expect(message).toBe('dir: expected an absolute path');
    });
  });
});
