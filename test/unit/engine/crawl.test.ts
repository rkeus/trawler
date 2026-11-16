import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startFixtureServer, type FixtureServer } from '../../helpers/fixture-server';
import { cdnSite, staticSite } from '../../fixtures/static-site';
import { crawl, SeedError, type CrawlOptions } from '../../../src/engine/crawl';
import { FetchError } from '../../../src/engine/types';
import { createFetcher } from '../../../src/engine/fetcher';
import { AdaptivePool } from '../../../src/engine/pool';
import { BlobStore } from '../../../src/engine/blob-store';
import { resolveSettings } from '../../../src/shared/settings';
import { makeTmpDir } from '../../helpers/tmp';

let cdn: FixtureServer;
let site: FixtureServer;
let misc: FixtureServer;
beforeAll(async () => {
  cdn = await startFixtureServer(() => cdnSite());
  site = await startFixtureServer(() => staticSite(cdn.url));
  misc = await startFixtureServer(() => ({
    '/s/start': { location: '/s/index.html' },
    '/s/index.html': {
      type: 'text/html',
      body: '<a href="start">self</a><a href="login">login</a><img src="ext.png">',
    },
    '/s/login': { location: '/account/login' },
    '/account/login': { type: 'text/html', body: '<p>login</p>' },
    '/s/ext.png': { location: `${cdn.url}/lib/cdn.png` },
  }));
});
afterAll(async () => {
  await misc.close();
  await site.close();
  await cdn.close();
});

async function run(kind: 'analyze' | 'download', overrides: Record<string, unknown> = {}, seed?: string) {
  const { settings } = resolveSettings({ retries: 0, ...overrides });
  const signal = new AbortController().signal;
  const blobStore = new BlobStore(path.join(await makeTmpDir('crawl'), 'blobs'));
  await blobStore.init();
  const opts: CrawlOptions = {
    seedUrl: seed ?? `${site.url}/html/index.html`,
    settings,
    fetcher: createFetcher({ fetchImpl: fetch, timeoutMs: 5000, retries: 0, signal }),
    pool: new AdaptivePool({ concurrency: 4 }),
    signal,
    emit: () => undefined,
    kind,
    blobStore,
  };
  return crawl(opts);
}

describe('crawl (download)', () => {
  it('crawls pages and assets within scope', async () => {
    const r = await run('download');
    const ok = [...r.records.values()].filter((x) => x.fetched && !x.duplicate);
    const pages = ok.filter((x) => x.isPage).map((x) => new URL(x.finalUrl).pathname).sort();
    expect(pages).toEqual(['/html/about.html', '/html/blog/', '/html/contact.php', '/html/index.html']);
    const paths = ok.map((x) => new URL(x.finalUrl).pathname + new URL(x.finalUrl).search);
    for (const p of [
      '/html/assets/css/style.css?v=3',
      '/html/assets/css/theme.css',
      '/html/assets/fonts/icons.woff2?v=1',
      '/html/assets/img/bg.png',
      '/html/assets/img/logo@2x.png',
      '/html/assets/img/lazy.png',
      '/assets/shared/common.css',
      '/assets/shared/pattern.png',
      '/lib/cdn.css',
      '/lib/cdn.png',
    ]) {
      expect(paths).toContain(p);
    }
    expect(ok.every((x) => typeof x.blobId === 'string')).toBe(true);
  });

  it('respects robots.txt and records errors and redirects', async () => {
    const r = await run('download');
    expect(site.requests).not.toContain('/html/private/secret.html');
    const missing = r.records.get(`${site.url}/html/assets/img/missing.png`)!;
    expect(missing.status).toBe(404);
    expect(missing.error).toBe('HTTP 404');
    expect(r.aliases.get(`${site.url}/html/old-page.html`)).toBe(`${site.url}/html/about.html`);
    expect(r.counters.errors).toBe(1);
    expect(r.externalHosts.get(new URL(cdn.url).host)).toBe(2);
  });

  it('skips external hosts when downloadExternal is off', async () => {
    const r = await run('download', { downloadExternal: false });
    expect([...r.records.keys()].some((u) => u.startsWith(cdn.url))).toBe(false);
    expect(r.externalHosts.get(new URL(cdn.url).host)).toBe(1);
  });

  it('stops at maxPages', async () => {
    const r = await run('download', { maxPages: 2 });
    expect(r.limitReached).toBe(true);
    expect([...r.records.values()].filter((x) => x.isPage).length).toBe(2);
    expect(r.warnings.join(' ')).toContain('Page limit');
  });

  it('throws SeedError with the failure reason when the start URL fails', async () => {
    const err = await run('download', {}, `${site.url}/html/nope.html`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SeedError);
    expect((err as SeedError).reason).toBe('http');
  });

  it('rethrows cancellation during the seed fetch as an aborted FetchError', async () => {
    const ac = new AbortController();
    ac.abort();
    const { settings } = resolveSettings({});
    const err = await crawl({
      seedUrl: `${site.url}/html/index.html`,
      settings,
      fetcher: createFetcher({ fetchImpl: fetch, timeoutMs: 5000, retries: 0, signal: ac.signal }),
      pool: new AdaptivePool({ concurrency: 1 }),
      signal: ac.signal,
      emit: () => undefined,
      kind: 'analyze',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).reason).toBe('aborted');
  });

  it('stops all work and rejects once on a fatal storage error', async () => {
    const { settings } = resolveSettings({ retries: 0, respectRobotsTxt: false });
    const signal = new AbortController().signal;
    let puts = 0;
    const failingStore = {
      put: async () => {
        puts++;
        if (puts >= 2) throw new Error('disk full');
        return `id${puts}`;
      },
    } as unknown as BlobStore;
    const before = site.requests.length;
    await expect(
      crawl({
        seedUrl: `${site.url}/html/index.html`,
        settings,
        fetcher: createFetcher({ fetchImpl: fetch, timeoutMs: 5000, retries: 0, signal }),
        pool: new AdaptivePool({ concurrency: 2 }),
        signal,
        emit: () => undefined,
        kind: 'download',
        blobStore: failingStore,
      }),
    ).rejects.toThrow('disk full');
    const after = site.requests.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(site.requests.length).toBe(after);
    expect(after - before).toBeLessThan(10);
  });

  it('skips page redirects outside the scope without counting errors', async () => {
    const r = await run('download', { downloadExternal: false }, `${misc.url}/s/start`);
    const login = r.records.get(`${misc.url}/s/login`)!;
    expect(login.skipped).toContain('outside the crawl scope');
    expect(login.error).toBeUndefined();
    expect(r.counters.errors).toBe(0);
    expect(r.warnings.join(' ')).toContain('redirect outside the crawl scope');
  });

  it('does not download assets that redirect to an external host when downloadExternal is off', async () => {
    const r = await run('download', { downloadExternal: false }, `${misc.url}/s/start`);
    const ext = r.records.get(`${misc.url}/s/ext.png`)!;
    expect(ext.skipped).toContain('external host');
    expect(ext.blobId).toBeUndefined();
  });

  it('does not fetch the pre-redirect start URL twice', async () => {
    const before = misc.requests.filter((p) => p === '/s/start').length;
    await run('download', {}, `${misc.url}/s/start`);
    expect(misc.requests.filter((p) => p === '/s/start').length - before).toBe(1);
  });

});

describe('crawl (analyze)', () => {
  it('fetches only pages and CSS and keeps bodies in memory', async () => {
    const before = site.requests.length;
    const r = await run('analyze');
    const requested = site.requests.slice(before);
    expect(requested).not.toContain('/html/assets/img/logo.png');
    expect(requested).toContain('/html/assets/css/style.css?v=3');
    const css = r.records.get(`${site.url}/html/assets/css/style.css?v=3`)!;
    expect(css.body?.toString()).toContain('@import');
    expect(css.blobId).toBeUndefined();
    const logo = r.records.get(`${site.url}/html/assets/img/logo.png`)!;
    expect(logo.fetched).toBe(false);
    expect(logo.kind).toBe('image');
  });
});
