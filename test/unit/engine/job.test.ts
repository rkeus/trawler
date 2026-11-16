import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG_1X1, startFixtureServer, type FixtureServer } from '../../helpers/fixture-server';
import { runJob, type JobRequest } from '../../../src/engine/job';
import { createStaticVerifier } from '../../../src/engine/static-verifier';
import { writeManifest, type Manifest } from '../../../src/engine/manifest';
import type { JobEvent, Verifier } from '../../../src/engine/types';
import { resolveSettings } from '../../../src/shared/settings';
import { makeTmpDir } from '../../helpers/tmp';

let site: FixtureServer;
beforeAll(async () => {
  site = await startFixtureServer(() => ({
    '/s/index.html': { type: 'text/html', body: '<a href="b.html">b</a><img src="i.png"><img src="none.png">' },
    '/s/b.html': { type: 'text/html', body: '<a href="index.html">i</a>' },
    '/s/i.png': { type: 'image/png', body: PNG_1X1 },
  }));
});
afterAll(() => site.close());

const tmp = () => makeTmpDir('job');

async function go(
  req: Partial<JobRequest>,
  opts: { abortOn?: (e: JobEvent) => boolean; preAbort?: boolean; emitThrows?: boolean; verifier?: Verifier } = {},
) {
  const ac = new AbortController();
  if (opts.preAbort) ac.abort();
  const events: JobEvent[] = [];
  const result = await runJob(
    {
      kind: 'download',
      seedUrl: `${site.url}/s/index.html`,
      settings: resolveSettings({ retries: 0, respectRobotsTxt: false }).settings,
      ...req,
    },
    { fetchImpl: fetch, verifier: opts.verifier ?? createStaticVerifier(fetch) },
    {
      signal: ac.signal,
      emit: (e) => {
        events.push(e);
        if (opts.abortOn?.(e)) ac.abort();
        if (opts.emitThrows) throw new Error('ipc gone');
      },
    },
  );
  return { result, events };
}

function previousManifest(paths: string[]): Manifest {
  return {
    trawlerVersion: '0.1.0',
    seedUrl: `${site.url}/s/index.html`,
    basePath: '/s/',
    startedAt: 'a',
    finishedAt: 'b',
    mode: 'static',
    settings: resolveSettings({}).settings,
    status: 'done',
    warnings: [],
    files: paths.map((p) => ({ url: `${site.url}/s/${p}`, aliases: [], path: p, status: 200, bytes: 1, kind: 'page' as const })),
    errors: [],
  };
}

describe('runJob (download)', () => {
  it('mirrors, writes manifest and report, clears blobs, verifies', async () => {
    const out = await tmp();
    const { result, events } = await go({ outputDir: out });
    expect(result.status).toBe('done_with_errors');
    expect(result.mode).toBe('static');
    expect(await fs.readFile(path.join(out, 'index.html'), 'utf8')).toContain(`src="${site.url}/s/none.png"`);
    expect(await fs.readFile(path.join(out, 'b.html'), 'utf8')).toContain('href="index.html"');
    const manifest = JSON.parse(await fs.readFile(path.join(out, '_trawler', 'manifest.json'), 'utf8'));
    expect(manifest.basePath).toBe('/s/');
    expect(manifest.errors).toHaveLength(1);
    await expect(fs.stat(path.join(out, '_trawler', 'blobs'))).rejects.toBeDefined();
    expect(result.verify).toEqual({ pagesChecked: 2, pagesOk: 2, missing: [] });
    expect(events.filter((e) => e.type === 'phase').map((e) => (e as { phase: string }).phase)).toEqual([
      'crawling',
      'rewriting',
      'verifying',
      'done',
    ]);
    expect(result.warnings.join(' ')).toContain('static mode');
  });

  it('fails when the folder is not empty and nonEmptyFolder is "ask"', async () => {
    const out = await tmp();
    await fs.writeFile(path.join(out, 'x.txt'), 'x');
    const { result } = await go({ outputDir: out });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('not empty');
  });

  it('honors an explicit folder policy', async () => {
    const out = await tmp();
    await fs.writeFile(path.join(out, 'x.txt'), 'x');
    const { result } = await go({ outputDir: out, folderPolicy: 'merge' });
    expect(result.status).toBe('done_with_errors');
    expect(await fs.readFile(path.join(out, 'x.txt'), 'utf8')).toBe('x');
  });

  it('keeps what was downloaded when cancelled', async () => {
    const out = await tmp();
    const { result } = await go({ outputDir: out }, { abortOn: (e) => e.type === 'progress' });
    expect(result.status).toBe('cancelled');
    const manifest = JSON.parse(await fs.readFile(path.join(out, '_trawler', 'manifest.json'), 'utf8'));
    expect(manifest.status).toBe('cancelled');
    expect(manifest.files.length).toBeGreaterThan(0);
  });

  it('fails clearly for JS mode (needs the desktop runtime)', async () => {
    const { result } = await go({
      outputDir: await tmp(),
      settings: resolveSettings({ mode: 'js', respectRobotsTxt: false }).settings,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('built-in browser');
  });

  it('fails clearly for an unreachable seed', async () => {
    const { result } = await go({ outputDir: await tmp(), seedUrl: `${site.url}/s/nope.html` });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('start URL');
  });

  it('keeps the previous mirror when the start URL fails (overwrite)', async () => {
    const out = await tmp();
    await fs.writeFile(path.join(out, 'index.html'), 'previous');
    await writeManifest(out, previousManifest(['index.html']));
    const { result } = await go({ outputDir: out, folderPolicy: 'overwrite', seedUrl: `${site.url}/s/nope.html` });
    expect(result.status).toBe('failed');
    expect(await fs.readFile(path.join(out, 'index.html'), 'utf8')).toBe('previous');
  });

  it('overwrite removes stale files of the previous mirror after success, keeps unknown files', async () => {
    const out = await tmp();
    await fs.writeFile(path.join(out, 'old.html'), 'old');
    await fs.writeFile(path.join(out, 'mine.txt'), 'mine');
    await writeManifest(out, previousManifest(['old.html', 'index.html']));
    const { result } = await go({ outputDir: out, folderPolicy: 'overwrite' });
    expect(result.status).toBe('done_with_errors');
    await expect(fs.stat(path.join(out, 'old.html'))).rejects.toBeDefined();
    expect(await fs.readFile(path.join(out, 'mine.txt'), 'utf8')).toBe('mine');
    expect(await fs.readFile(path.join(out, 'index.html'), 'utf8')).toContain('b.html');
  });

  it('merge keeps files of the previous mirror tracked in the manifest', async () => {
    const out = await tmp();
    await fs.writeFile(path.join(out, 'old.html'), 'old');
    await writeManifest(out, previousManifest(['old.html']));
    await go({ outputDir: out, folderPolicy: 'merge' });
    const manifest = JSON.parse(await fs.readFile(path.join(out, '_trawler', 'manifest.json'), 'utf8'));
    expect(manifest.files.map((f: { path: string }) => f.path)).toContain('old.html');
  });

  it('reports cancelled when cancelled before the start URL loads', async () => {
    const { result } = await go({ outputDir: await tmp() }, { preAbort: true });
    expect(result.status).toBe('cancelled');
    expect(result.error).toBeUndefined();
  });

  it('survives a throwing event listener', async () => {
    const { result } = await go({ outputDir: await tmp() }, { emitThrows: true });
    expect(result.status).toBe('done_with_errors');
  });

  it('isolates verifier failures', async () => {
    const out = await tmp();
    const broken: Verifier = { verify: async () => Promise.reject(new Error('no browser')) };
    const { result } = await go({ outputDir: out }, { verifier: broken });
    expect(result.status).toBe('done_with_errors');
    expect(result.warnings.join(' ')).toContain('Verification could not run');
    await expect(fs.stat(path.join(out, '_trawler', 'report.json'))).resolves.toBeDefined();
  });

  it('finishes with a warning when a stale file cannot be removed', async () => {
    const out = await tmp();
    await fs.mkdir(path.join(out, 'stale'), { recursive: true });
    await fs.writeFile(path.join(out, 'stale', 'user.txt'), 'mine');
    await writeManifest(out, previousManifest(['stale']));
    const { result } = await go({ outputDir: out, folderPolicy: 'overwrite' });
    expect(result.status).toBe('done_with_errors');
    expect(result.warnings.join(' ')).toContain('Could not remove 1 file');
    const manifest = JSON.parse(await fs.readFile(path.join(out, '_trawler', 'manifest.json'), 'utf8'));
    expect(manifest.files.map((f: { path: string }) => f.path)).toContain('stale');
  });
});

describe('runJob (analyze)', () => {
  it('reports without writing files', async () => {
    const { result } = await go({ kind: 'analyze', outputDir: undefined });
    expect(result.status).toBe('done');
    expect(result.analysis?.pages).toEqual([`${site.url}/s/b.html`, `${site.url}/s/index.html`]);
    expect(result.analysis?.assetCounts.image).toBe(2);
  });
});
