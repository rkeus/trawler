import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startFixtureServer, type FixtureServer } from '../helpers/fixture-server';
import { makeTmpDir } from '../helpers/tmp';
import { cdnSite, staticSite } from '../fixtures/static-site';
import { spaLiveSite } from '../fixtures/spa-live-site';
import { runCli } from './run-cli';

let cdn: FixtureServer;
let site: FixtureServer;
let spa: FixtureServer;
beforeAll(async () => {
  cdn = await startFixtureServer(() => cdnSite());
  site = await startFixtureServer(() => staticSite(cdn.url));
  spa = await startFixtureServer(() => spaLiveSite());
});
afterAll(async () => {
  await spa.close();
  await site.close();
  await cdn.close();
});

const fast = JSON.stringify({ retries: 0, respectRobotsTxt: false });
const exists = (dir: string, p: string) => fs.stat(path.join(dir, ...p.split('/')));

describe('trawler --trawler-cli (real Electron)', () => {
  it('mirrors a static template, detects it as static and verifies it in the browser', async () => {
    const out = await makeTmpDir('cli');
    const r = await runCli(['--url', `${site.url}/html/index.html`, '--out', out, '--settings', JSON.stringify({ retries: 0 })]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.result.status).toBe('done_with_errors'); // missing.png is a real 404
    expect(r.result.mode).toBe('static');
    expect(r.result.detection.verdict).toBe('static');
    expect(r.result.verify.missing).toEqual([]);
    await expect(exists(out, 'html/index.html')).resolves.toBeDefined();
    await expect(exists(out, `vendor/${new URL(cdn.url).host.replace(':', '_')}/lib/cdn.css`)).resolves.toBeDefined();
  });

  it('detects a SPA, mirrors it in JS mode, and the copy works offline', async () => {
    const out = await makeTmpDir('cli');
    const r = await runCli(['--url', `${spa.url}/app/`, '--out', out, '--settings', fast]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.result.mode).toBe('js');
    expect(r.result.detection.verdict).toBe('js');
    for (const p of [
      'index.html',
      'about/index.html',
      'assets/index-AbCdEf12.js',
      'assets/chunk-1234abcd.js',
      'api/items.json',
      'img/pic.png',
    ]) {
      await expect(exists(out, p)).resolves.toBeDefined();
    }
    expect(r.result.verify.missing).toEqual([]);
  });

  it('analyzes a SPA without writing files', async () => {
    const r = await runCli(['--kind', 'analyze', '--url', `${spa.url}/app/`, '--settings', fast]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.result.analysis.detection.verdict).toBe('js');
    expect(r.result.analysis.pages).toContain(`${spa.url}/app/about`);
  });

  it('rejects missing arguments with exit code 64', async () => {
    const r = await runCli(['--kind', 'download']);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain('--url is required');
  });
});
