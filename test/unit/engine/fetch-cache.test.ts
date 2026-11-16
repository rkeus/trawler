import { describe, it, expect } from 'vitest';
import { FetchCache } from '../../../src/engine/fetch-cache';
import type { FetchedResource, Fetcher } from '../../../src/engine/types';

function res(url: string, body = 'abc', extra: Partial<FetchedResource> = {}): FetchedResource {
  const b = Buffer.from(body);
  return { url, finalUrl: url, status: 200, contentType: 'text/html', headers: { etag: '1' }, body: b, size: b.length, ...extra };
}

function counting(make: (url: string) => FetchedResource = (u) => res(u)): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      return make(url);
    },
  };
}

describe('FetchCache', () => {
  it('serves a recorded response without a new request', async () => {
    const cache = new FetchCache(1024);
    const first = counting((u) => res(u, 'page', { finalUrl: `${u}?redirected` }));
    await cache.record(first).fetch('https://a.test/x');
    const second = counting();
    const served = await cache.serve(second).fetch('https://a.test/x');
    expect(second.calls).toEqual([]);
    expect(served.body.toString()).toBe('page');
    expect(served.finalUrl).toBe('https://a.test/x?redirected');
    expect(cache.size).toBe(1);
    expect(cache.bytes).toBe(4);
  });

  it('passes misses through', async () => {
    const cache = new FetchCache(1024);
    const inner = counting();
    await cache.serve(inner).fetch('https://a.test/y');
    expect(inner.calls).toEqual(['https://a.test/y']);
  });

  it('does not keep bodies that were spilled to disk', async () => {
    const cache = new FetchCache(1024);
    await cache.record(counting((u) => res(u, '', { spilledBlobId: 'b1', size: 5000 }))).fetch('https://a.test/big');
    expect(cache.size).toBe(0);
  });

  it('stops recording when the memory budget is spent', async () => {
    const cache = new FetchCache(5);
    const rec = cache.record(counting());
    await rec.fetch('https://a.test/1');
    await rec.fetch('https://a.test/2');
    expect(cache.size).toBe(1);
    expect(cache.bytes).toBe(3);
  });

  it('does not record failures', async () => {
    const cache = new FetchCache(1024);
    const failing: Fetcher = { fetch: async () => Promise.reject(new Error('HTTP 500')) };
    await expect(cache.record(failing).fetch('https://a.test/z')).rejects.toThrow('HTTP 500');
    expect(cache.size).toBe(0);
  });

  it('hands out copies whose headers can be changed safely', async () => {
    const cache = new FetchCache(1024);
    await cache.record(counting()).fetch('https://a.test/h');
    const a = await cache.serve(counting()).fetch('https://a.test/h');
    a.headers.etag = 'changed';
    const b = await cache.serve(counting()).fetch('https://a.test/h');
    expect(b.headers.etag).toBe('1');
  });

  it('clear() empties the cache', async () => {
    const cache = new FetchCache(1024);
    await cache.record(counting()).fetch('https://a.test/c');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });
});
