import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { FetchCache, runJob } from '../../../src/engine';
import { JobBusyError, JobManager, type JobManagerDeps } from '../../../src/main/job-manager';
import type { HistoryEntry, JobEventMessage, JobFinishedMessage } from '../../../src/shared/ipc';
import { resolveSettings } from '../../../src/shared/settings';
import { startFixtureServer, type FixtureServer } from '../../helpers/fixture-server';
import { makeTmpDir } from '../../helpers/tmp';
import { cdnSite, staticSite } from '../../fixtures/static-site';

let cdn: FixtureServer;
let site: FixtureServer;
let slow: FixtureServer;
beforeAll(async () => {
  cdn = await startFixtureServer(() => cdnSite());
  site = await startFixtureServer(() => staticSite(cdn.url));
  slow = await startFixtureServer(() => ({ '/slow/': { type: 'text/html', body: '<p>slow</p>', delayMs: 10000 } }));
});
afterAll(async () => {
  await slow.close();
  await site.close();
  await cdn.close();
});

function harness(over: Partial<JobManagerDeps> = {}) {
  const events: JobEventMessage[] = [];
  const finished: JobFinishedMessage[] = [];
  const recorded: HistoryEntry[] = [];
  let disposed = 0;
  const waiters: ((m: JobFinishedMessage) => void)[] = [];
  const manager = new JobManager({
    settings: () => resolveSettings({ retries: 0 }).settings,
    createPorts: () => ({
      ports: { fetchImpl: fetch },
      dispose: async () => {
        disposed++;
      },
    }),
    record: async (entry) => {
      recorded.push(entry);
      return entry;
    },
    onEvent: (m) => events.push(m),
    onFinished: (m) => {
      finished.push(m);
      for (const w of waiters) w(m);
    },
    ...over,
  });
  const done = (jobId: string) =>
    new Promise<JobFinishedMessage>((resolve) => {
      const hit = finished.find((m) => m.jobId === jobId);
      if (hit) return resolve(hit);
      waiters.push((m) => {
        if (m.jobId === jobId) resolve(m);
      });
    });
  return { manager, events, finished, recorded, done, disposed: () => disposed };
}

const seed = () => `${site.url}/html/index.html`;

describe('JobManager', () => {
  it('runs an analysis, forwards its events and records it', async () => {
    const h = harness();
    const { jobId, usesAnalysisCache } = h.manager.start({ kind: 'analyze', seedUrl: seed() });
    expect(usesAnalysisCache).toBe(false);
    expect(h.manager.current()).toMatchObject({ jobId, kind: 'analyze', seedUrl: seed() });
    const msg = await h.done(jobId);
    expect(msg.result.status).toBe('done');
    expect(msg.result.analysis?.pages).toContain(seed());
    expect(msg.history?.id).toBe(jobId);
    expect(h.recorded.map((e) => e.id)).toEqual([jobId]);
    expect(h.events.length).toBeGreaterThan(0);
    expect(h.events.every((e) => e.jobId === jobId)).toBe(true);
    expect(h.events.some((e) => e.event.type === 'phase' && e.event.phase === 'done')).toBe(true);
    expect(h.manager.current()).toBeUndefined();
    expect(h.disposed()).toBe(1);
  });

  it('runs one job at a time and tracks its phase', async () => {
    const h = harness();
    const { jobId } = h.manager.start({ kind: 'analyze', seedUrl: `${slow.url}/slow/` });
    expect(() => h.manager.start({ kind: 'analyze', seedUrl: seed() })).toThrow(JobBusyError);
    await vi.waitFor(() => expect(h.manager.current()?.phase).toBe('crawling'));
    expect(h.manager.cancel('someone-else')).toBe(false);
    expect(h.manager.cancel(jobId)).toBe(true);
    const msg = await h.done(jobId);
    expect(msg.result.status).toBe('cancelled');
    expect(h.manager.current()).toBeUndefined();
  });

  it('shutdown() cancels the running job and waits for it', async () => {
    const h = harness();
    const { jobId } = h.manager.start({ kind: 'download', seedUrl: `${slow.url}/slow/`, outputDir: await makeTmpDir('jm') });
    await h.manager.shutdown();
    expect(h.finished.map((m) => [m.jobId, m.result.status])).toEqual([[jobId, 'cancelled']]);
    expect(h.disposed()).toBe(1);
  });

  it('applies per-job settings on top of the saved ones', async () => {
    const h = harness();
    const r = h.manager.start({ kind: 'analyze', seedUrl: seed(), settings: { maxPages: 1, bogus: true } });
    expect(r.settings.maxPages).toBe(1);
    expect(r.settings.retries).toBe(0);
    expect(r.warnings).toEqual(['Unknown setting "bogus" ignored']);
    const msg = await h.done(r.jobId);
    expect(msg.result.analysis?.pages).toHaveLength(1);
    expect(h.recorded[0]!.settings.maxPages).toBe(1);
  });

  it('reuses the analysis for the next download of the same URL, once', async () => {
    const h = harness();
    const a = h.manager.start({ kind: 'analyze', seedUrl: seed() });
    await h.done(a.jobId);
    const before = site.requests.length;
    const d = h.manager.start({ kind: 'download', seedUrl: seed(), outputDir: await makeTmpDir('jm') });
    expect(d.usesAnalysisCache).toBe(true);
    const msg = await h.done(d.jobId);
    expect(msg.result.status).toBe('done_with_errors'); // missing.png is a real 404
    const during = site.requests.slice(before);
    expect(during).not.toContain('/html/index.html');
    expect(during).not.toContain('/html/about.html');
    expect(during.some((p) => p.startsWith('/html/assets/img/'))).toBe(true);
    const again = h.manager.start({ kind: 'download', seedUrl: seed(), outputDir: await makeTmpDir('jm') });
    expect(again.usesAnalysisCache).toBe(false);
    await h.done(again.jobId);
  });

  it('does not reuse an expired analysis', async () => {
    let clock = 1_000_000;
    const h = harness({ now: () => clock });
    const a = h.manager.start({ kind: 'analyze', seedUrl: seed() });
    await h.done(a.jobId);
    clock += resolveSettings({}).settings.analysisCacheTtlMs + 1;
    const d = h.manager.start({ kind: 'download', seedUrl: seed(), outputDir: await makeTmpDir('jm') });
    expect(d.usesAnalysisCache).toBe(false);
    await h.done(d.jobId);
  });

  it('does not reuse an analysis of another URL or user agent', async () => {
    const h = harness();
    const run = async (kind: 'analyze' | 'download', seedUrl: string, settings?: Record<string, unknown>) => {
      const r = h.manager.start({
        kind,
        seedUrl,
        ...(kind === 'download' ? { outputDir: await makeTmpDir('jm') } : {}),
        ...(settings ? { settings } : {}),
      });
      await h.done(r.jobId);
      return r.usesAnalysisCache;
    };
    await run('analyze', seed());
    expect(await run('download', `${site.url}/html/about.html`)).toBe(false);
    await run('analyze', seed());
    expect(await run('download', seed(), { userAgent: 'Other/1.0' })).toBe(false);
  });

  it('does not keep an analysis when the saved cache setting is off', async () => {
    const h = harness({ settings: () => resolveSettings({ retries: 0, analysisCacheTtlMs: 0 }).settings });
    const a = h.manager.start({ kind: 'analyze', seedUrl: seed() });
    await h.done(a.jobId);
    expect(h.manager.analysisCache()).toBeUndefined();
  });

  it('ignores app-level settings in per-job changes', async () => {
    const h = harness();
    const saved = resolveSettings({ retries: 0 }).settings;
    const r = h.manager.start({
      kind: 'analyze',
      seedUrl: seed(),
      settings: { historySize: 3, analysisCacheTtlMs: 0, analysisCacheMaxBytes: 0, shutdownTimeoutMs: 1000, maxPages: 2 },
    });
    expect(r.settings.historySize).toBe(saved.historySize);
    expect(r.settings.analysisCacheTtlMs).toBe(saved.analysisCacheTtlMs);
    expect(r.settings.analysisCacheMaxBytes).toBe(saved.analysisCacheMaxBytes);
    expect(r.settings.shutdownTimeoutMs).toBe(saved.shutdownTimeoutMs);
    expect(r.settings.maxPages).toBe(2);
    expect(r.warnings).toEqual([]);
    await h.done(r.jobId);
    expect(h.manager.analysisCache()).toBeDefined(); // the per-job "cache off" was ignored
  });

  it('counts the cache lifetime from the end of the analysis', async () => {
    let clock = 1_000_000;
    const ttl = resolveSettings({}).settings.analysisCacheTtlMs;
    const h = harness({
      now: () => clock,
      run: async (...args: Parameters<typeof runJob>) => {
        clock += ttl - 1; // a long analysis
        return runJob(...args);
      },
    });
    const a = h.manager.start({ kind: 'analyze', seedUrl: seed() });
    await h.done(a.jobId);
    expect(h.manager.analysisCache()?.expiresAt).toBe(clock + ttl);
    clock += 2;
    const d = h.manager.start({ kind: 'download', seedUrl: seed(), outputDir: await makeTmpDir('jm') });
    expect(d.usesAnalysisCache).toBe(true);
    await h.done(d.jobId);
  });

  it('frees the analysis when it expires', async () => {
    const h = harness({ settings: () => resolveSettings({ retries: 0, analysisCacheTtlMs: 200 }).settings });
    const a = h.manager.start({ kind: 'analyze', seedUrl: seed() });
    await h.done(a.jobId);
    expect(h.manager.analysisCache()?.bytes).toBeGreaterThan(0);
    await vi.waitFor(() => expect(h.manager.analysisCache()).toBeUndefined(), { timeout: 3000 });
  });

  it('does not keep a cancelled analysis', async () => {
    const h = harness();
    const a = h.manager.start({ kind: 'analyze', seedUrl: `${slow.url}/slow/` });
    h.manager.cancel(a.jobId);
    expect((await h.done(a.jobId)).result.status).toBe('cancelled');
    expect(h.manager.analysisCache()).toBeUndefined();
  });

  it('refuses new jobs once shut down', async () => {
    const h = harness();
    await h.manager.shutdown();
    expect(() => h.manager.start({ kind: 'analyze', seedUrl: seed() })).toThrow('Trawler is shutting down.');
  });

  it('reports a failure to create the ports as a failed job and stays usable', async () => {
    const h = harness({
      createPorts: () => {
        throw new Error('no browser');
      },
    });
    const first = h.manager.start({ kind: 'analyze', seedUrl: seed() });
    const msg = await h.done(first.jobId);
    expect(msg.result).toMatchObject({ status: 'failed', error: 'no browser' });
    const second = h.manager.start({ kind: 'analyze', seedUrl: seed() });
    expect((await h.done(second.jobId)).result.status).toBe('failed');
  });

  it('still reports the result when the history cannot be saved', async () => {
    const h = harness({
      record: async () => {
        throw new Error('disk full');
      },
    });
    const r = h.manager.start({ kind: 'analyze', seedUrl: seed() });
    const msg = await h.done(r.jobId);
    expect(msg.result.status).toBe('done');
    expect(msg.history).toBeUndefined();
  });

  it('a listener that throws does not break the job', async () => {
    const h = harness({
      onEvent: () => {
        throw new Error('window closed');
      },
    });
    const r = h.manager.start({ kind: 'analyze', seedUrl: seed() });
    expect((await h.done(r.jobId)).result.status).toBe('done');
  });

  it('frees a replaced or consumed analysis at once', async () => {
    const clear = vi.spyOn(FetchCache.prototype, 'clear');
    try {
      const h = harness();
      const a1 = h.manager.start({ kind: 'analyze', seedUrl: seed() });
      await h.done(a1.jobId);
      expect(clear).not.toHaveBeenCalled();
      const a2 = h.manager.start({ kind: 'analyze', seedUrl: seed() });
      expect(clear).toHaveBeenCalledTimes(1); // the first analysis, replaced
      await h.done(a2.jobId);
      const d = h.manager.start({ kind: 'download', seedUrl: seed(), outputDir: await makeTmpDir('jm') });
      expect(d.usesAnalysisCache).toBe(true);
      await h.done(d.jobId);
      expect(clear).toHaveBeenCalledTimes(2); // the second analysis, consumed by the download
      for (const cache of clear.mock.contexts as FetchCache[]) expect(cache.bytes).toBe(0);
      expect(h.manager.analysisCache()).toBeUndefined();
    } finally {
      clear.mockRestore();
    }
  });
});
