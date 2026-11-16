import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { startServer, type TestServer } from '../../helpers/http-server';
import { createFetcher, backoffMs, parseRetryAfter } from '../../../src/engine/fetcher';
import { isBotChallenge, looksLikeChallengePage } from '../../../src/engine/challenge';
import { FetchError, type FetchImpl } from '../../../src/engine/types';
import { BlobStore } from '../../../src/engine/blob-store';
import { makeTmpDir } from '../../helpers/tmp';
import path from 'node:path';

let server: TestServer;
const hits = new Map<string, number>();
let lastUa = '';

beforeAll(async () => {
  server = await startServer((req, res) => {
    const p = req.url ?? '/';
    const n = (hits.get(p) ?? 0) + 1;
    hits.set(p, n);
    lastUa = req.headers['user-agent'] ?? '';
    if (p === '/ok') return void res.writeHead(200, { 'content-type': 'text/plain' }).end('hello');
    if (p === '/redirect') return void res.writeHead(301, { location: '/ok' }).end();
    if (p === '/missing') return void res.writeHead(404).end('no');
    if (p === '/flaky') return void (n === 1 ? res.writeHead(500).end() : res.writeHead(200).end('ok now'));
    if (p === '/busy') return void res.writeHead(503, { 'retry-after': '0' }).end();
    if (p === '/slow') return void setTimeout(() => res.writeHead(200).end('late'), 300);
    if (p === '/challenge')
      return void res.writeHead(403, { 'content-type': 'text/html' }).end('<html><title>Just a moment...</title></html>');
    if (p === '/stall') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('abc');
      return void setTimeout(() => res.end('def'), 1000);
    }
    if (p === '/steady') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      let i = 0;
      const t = setInterval(() => {
        res.write('x'.repeat(10));
        if (++i === 8) {
          clearInterval(t);
          res.end();
        }
      }, 50);
      return;
    }
    if (p === '/big') return void res.writeHead(200, { 'content-type': 'video/mp4' }).end(Buffer.alloc(65536, 7));
    res.writeHead(500).end();
  });
});
afterAll(() => server.close());

const noSleep = async (): Promise<void> => undefined;
const mk = (over: Partial<Parameters<typeof createFetcher>[0]> = {}) =>
  createFetcher({ fetchImpl: fetch, timeoutMs: 5000, retries: 2, signal: new AbortController().signal, sleep: noSleep, ...over });

describe('createFetcher', () => {
  it('returns body, status, content type and final URL', async () => {
    const r = await mk().fetch(`${server.url}/redirect`);
    expect(r.status).toBe(200);
    expect(r.body.toString()).toBe('hello');
    expect(r.contentType).toBe('text/plain');
    expect(r.url).toBe(`${server.url}/redirect`);
    expect(r.finalUrl).toBe(`${server.url}/ok`);
  });

  it('does not retry 404', async () => {
    const err = await mk().fetch(`${server.url}/missing`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).status).toBe(404);
    expect((err as FetchError).reason).toBe('http');
    expect(hits.get('/missing')).toBe(1);
  });

  it('retries 5xx and succeeds', async () => {
    const r = await mk().fetch(`${server.url}/flaky`);
    expect(r.body.toString()).toBe('ok now');
    expect(hits.get('/flaky')).toBe(2);
  });

  it('calls onThrottle on 503 and gives up after the retries', async () => {
    const onThrottle = vi.fn();
    const err = await mk({ onThrottle }).fetch(`${server.url}/busy`).catch((e: unknown) => e);
    expect((err as FetchError).status).toBe(503);
    expect(hits.get('/busy')).toBe(3);
    expect(onThrottle).toHaveBeenCalledTimes(3);
  });

  it('times out', async () => {
    const err = await mk({ timeoutMs: 50, retries: 0 }).fetch(`${server.url}/slow`).catch((e: unknown) => e);
    expect((err as FetchError).reason).toBe('timeout');
  });

  it('reports abort', async () => {
    const ac = new AbortController();
    ac.abort();
    const err = await mk({ signal: ac.signal }).fetch(`${server.url}/ok`).catch((e: unknown) => e);
    expect((err as FetchError).reason).toBe('aborted');
  });

  it('detects bot challenges without retrying', async () => {
    const err = await mk().fetch(`${server.url}/challenge`).catch((e: unknown) => e);
    expect((err as FetchError).reason).toBe('challenge');
    expect(hits.get('/challenge')).toBe(1);
  });

  it('sends the configured user agent', async () => {
    await mk({ userAgent: 'TrawlerTest/1' }).fetch(`${server.url}/ok`);
    expect(lastUa).toBe('TrawlerTest/1');
  });

  it('times out when the body stalls (idle timeout)', async () => {
    const err = await mk({ idleTimeoutMs: 100, retries: 0 }).fetch(`${server.url}/stall`).catch((e: unknown) => e);
    expect((err as FetchError).reason).toBe('timeout');
    expect((err as FetchError).message).toContain('No data');
  });

  it('keeps reading a slow but steady body past the header timeout', async () => {
    const r = await mk({ timeoutMs: 200, idleTimeoutMs: 150, retries: 0 }).fetch(`${server.url}/steady`);
    expect(r.body.length).toBe(80);
    expect(r.size).toBe(80);
  });

  it('spills large bodies to the blob store', async () => {
    const store = new BlobStore(path.join(await makeTmpDir('spill'), 'blobs'));
    await store.init();
    const r = await mk({ memoryLimitBytes: 1024, spillTo: () => store }).fetch(`${server.url}/big`);
    expect(r.body.length).toBe(0);
    expect(r.size).toBe(65536);
    expect(r.spilledBlobId).toBeDefined();
    expect((await store.get(r.spilledBlobId!)).equals(Buffer.alloc(65536, 7))).toBe(true);
  });

  it('cancels a response that arrives after a timeout (fetchImpl ignoring the signal)', async () => {
    let cancelled = false;
    const slowImpl: FetchImpl = () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve(
              new Response(
                new ReadableStream({
                  start(c) {
                    c.enqueue(new Uint8Array([1]));
                  },
                  cancel() {
                    cancelled = true;
                  },
                }),
              ),
            ),
          150,
        ),
      );
    const err = await createFetcher({ fetchImpl: slowImpl, timeoutMs: 30, retries: 0, signal: new AbortController().signal })
      .fetch('http://x.test/')
      .catch((e: unknown) => e);
    expect((err as FetchError).reason).toBe('timeout');
    await new Promise((r) => setTimeout(r, 250));
    expect(cancelled).toBe(true);
  });
});

describe('helpers', () => {
  it('computes backoff', () => {
    expect(backoffMs(1)).toBe(500);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(5)).toBe(2000);
  });
  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });
  it('detects challenge pages', () => {
    expect(isBotChallenge(200, { 'cf-mitigated': 'challenge' }, '')).toBe(true);
    expect(isBotChallenge(503, {}, '<title>Attention Required! | Cloudflare</title>')).toBe(true);
    expect(isBotChallenge(403, {}, '<title>Forbidden</title>')).toBe(false);
    expect(isBotChallenge(200, {}, '<title>Just a moment</title>')).toBe(false);
  });
  it('recognizes challenge page text regardless of status', () => {
    expect(looksLikeChallengePage('Just a moment...\n<html>')).toBe(false);
    expect(looksLikeChallengePage('<title>Just a moment...</title>')).toBe(true);
    expect(looksLikeChallengePage('x<div id="challenge-platform">')).toBe(true);
    expect(looksLikeChallengePage('<title>Home</title><p>Welcome</p>')).toBe(false);
  });
});
