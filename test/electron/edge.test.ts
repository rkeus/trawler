import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startFixtureServer, type FixtureServer } from '../helpers/fixture-server';
import { makeTmpDir } from '../helpers/tmp';
import { edgeSites } from '../fixtures/edge-sites';
import { runCli } from './run-cli';

let edge: FixtureServer;
beforeAll(async () => {
  edge = await startFixtureServer((origin) => edgeSites(origin));
});
afterAll(() => edge.close());

const fast = JSON.stringify({ retries: 0, respectRobotsTxt: false });
const read = (dir: string, p: string) => fs.readFile(path.join(dir, ...p.split('/')), 'utf8');

describe('Electron runtime edge cases', () => {
  it('follows a redirect to another host and crawls in the final scope', async () => {
    const out = await makeTmpDir('edge');
    const seed = `${edge.url.replace('127.0.0.1', 'localhost')}/e/start`;
    const r = await runCli(['--url', seed, '--out', out, '--mode', 'static', '--settings', fast]);
    expect(r.code, r.stderr).toBe(0);
    for (const p of ['index.html', 'about.html', 'contact.html']) {
      await expect(fs.stat(path.join(out, p))).resolves.toBeDefined();
    }
    const manifest = JSON.parse(await read(out, '_trawler/manifest.json'));
    expect(manifest.seedUrl).toBe(`${edge.url}/e/index.html`);
  });

  it('keeps the main page when an iframe finishes first (JS mode)', async () => {
    const out = await makeTmpDir('edge');
    const r = await runCli(['--url', `${edge.url}/f/`, '--out', out, '--mode', 'js', '--settings', fast]);
    expect(r.code, r.stderr).toBe(0);
    const html = await read(out, 'index.html');
    expect(html).toContain('Main page text');
    expect(html).not.toContain('FRAME');
  });

  it('captures pages that open alert() and confirm() dialogs without waiting for the timeout', async () => {
    const out = await makeTmpDir('edge');
    const t0 = Date.now();
    const r = await runCli([
      '--url', `${edge.url}/a/`, '--out', out, '--mode', 'js',
      '--settings', JSON.stringify({ retries: 0, respectRobotsTxt: false, renderTimeoutMs: 20000 }),
    ]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.result.status).toBe('done');
    expect(Date.now() - t0).toBeLessThan(18000);
    expect(await read(out, 'index.html')).toContain('Alert page');
  });

  it('keeps a download-type link as a file in JS mode', async () => {
    const out = await makeTmpDir('edge');
    const r = await runCli(['--url', `${edge.url}/z/`, '--out', out, '--mode', 'js', '--settings', fast]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.result.status).toBe('done');
    expect((await fs.stat(path.join(out, 'download'))).isFile()).toBe(true);
  });

  it('does not report beacons and POST requests as missing files', async () => {
    const out = await makeTmpDir('edge');
    const r = await runCli(['--url', `${edge.url}/b/`, '--out', out, '--settings', fast]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.result.verify.missing).toEqual([]);
  });
});
