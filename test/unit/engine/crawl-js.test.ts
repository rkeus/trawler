import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { startFixtureServer, type FixtureServer } from '../../helpers/fixture-server';
import { fakeCapturer } from '../../helpers/fake-capturer';
import { makeTmpDir } from '../../helpers/tmp';
import { SPA_SHELL, spaRendered, spaSite } from '../../fixtures/spa-site';
import { crawl, resolveSeed } from '../../../src/engine/crawl';
import { createFetcher } from '../../../src/engine/fetcher';
import { AdaptivePool } from '../../../src/engine/pool';
import { BlobStore } from '../../../src/engine/blob-store';
import type { Capturer } from '../../../src/engine/types';
import { resolveSettings } from '../../../src/shared/settings';

let spa: FixtureServer;
beforeAll(async () => {
  spa = await startFixtureServer(() => spaSite());
});
afterAll(() => spa.close());

function spaCapturer() {
  return fakeCapturer((url) => ({
    html: SPA_SHELL,
    renderedHtml: spaRendered(),
    resources: url.endsWith('/app/')
      ? [
          { url: `${spa.url}/app/assets/index-AbCdEf12.js`, status: 200, contentType: 'text/javascript', body: Buffer.from('import("./chunk-1234abcd.js");'), type: 'Script' },
          { url: `${spa.url}/app/assets/chunk-1234abcd.js`, status: 200, contentType: 'text/javascript', body: Buffer.from('export default 1;'), type: 'Script' },
          { url: `${spa.url}/app/api/items.json`, status: 200, contentType: 'application/json', body: Buffer.from('[1,2,3]'), type: 'Fetch' },
        ]
      : [],
    dataRequests: 1,
  }));
}

async function run(kind: 'analyze' | 'download', capturer: Capturer, overrides: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const { settings } = resolveSettings({ retries: 0, respectRobotsTxt: false, ...overrides });
  const signal = new AbortController().signal;
  const blobStore = new BlobStore(path.join(await makeTmpDir('crawljs'), 'blobs'));
  await blobStore.init();
  return crawl({
    seedUrl: `${spa.url}/app/`,
    settings,
    fetcher: createFetcher({ fetchImpl: fetch, timeoutMs: 5000, retries: 0, signal }),
    pool: new AdaptivePool({ concurrency: 4 }),
    signal,
    emit: () => undefined,
    kind,
    blobStore,
    mode: 'js',
    capturer,
    ...extra,
  });
}

describe('crawl (JS mode)', () => {
  it('renders pages, adopts captured resources and follows rendered links', async () => {
    const cap = spaCapturer();
    const before = spa.requests.length;
    const r = await run('download', cap);
    const requested = spa.requests.slice(before);
    expect(cap.calls).toEqual([`${spa.url}/app/`, `${spa.url}/app/about`]);
    const js = r.records.get(`${spa.url}/app/assets/index-AbCdEf12.js`)!;
    expect(js.blobId).toBeDefined();
    expect(requested).not.toContain('/app/assets/index-AbCdEf12.js');
    expect(r.records.get(`${spa.url}/app/api/items.json`)?.kind).toBe('data');
    expect(requested).toContain('/app/img/lazy.png');
    expect(r.records.get(`${spa.url}/app/about`)?.isPage).toBe(true);
  });

  it('reuses a seed capture made during detection', async () => {
    const cap = spaCapturer();
    const signal = new AbortController().signal;
    const fetcher = createFetcher({ fetchImpl: fetch, timeoutMs: 5000, retries: 0, signal });
    const seed = await resolveSeed(fetcher, `${spa.url}/app/`);
    const seedCapture = await cap.capture(`${spa.url}/app/`, { timeoutMs: 1000, networkIdleMs: 100, autoScroll: false, signal });
    cap.calls.length = 0;
    await run('download', cap, {}, { seed, seedCapture });
    expect(cap.calls).toEqual([`${spa.url}/app/about`]);
  });

  it('renders at most analyzeRenderPages pages when analyzing', async () => {
    const cap = spaCapturer();
    const before = spa.requests.length;
    await run('analyze', cap, { analyzeRenderPages: 1 });
    expect(cap.calls).toEqual([`${spa.url}/app/`]);
    expect(spa.requests.slice(before)).toContain('/app/about');
  });

  it('records a render failure as a page error and continues', async () => {
    const broken: Capturer = { capture: async () => Promise.reject(new Error('renderer crashed')) };
    const r = await run('download', broken, {}, { seed: await resolveSeed(createFetcher({ fetchImpl: fetch, timeoutMs: 5000, retries: 0, signal: new AbortController().signal }), `${spa.url}/app/`) });
    const page = r.records.get(`${spa.url}/app/`)!;
    expect(page.error).toContain('Rendering failed');
    expect(r.counters.errors).toBe(1);
  });

  it('calls onHalt once on a fatal storage error', async () => {
    const onHalt = vi.fn();
    const failingStore = { put: async () => Promise.reject(new Error('disk full')) } as unknown as BlobStore;
    await expect(run('download', spaCapturer(), {}, { blobStore: failingStore, onHalt })).rejects.toThrow('disk full');
    expect(onHalt).toHaveBeenCalledTimes(1);
  });

  it('requires a capturer in JS mode', async () => {
    await expect(run('download', undefined as unknown as Capturer)).rejects.toThrow('capturer');
  });
});
