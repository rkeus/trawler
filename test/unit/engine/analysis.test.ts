import { describe, it, expect } from 'vitest';
import { computeScope } from '../../../src/core';
import { buildAnalysisReport } from '../../../src/engine/analysis';
import type { CrawlRecord, CrawlResult } from '../../../src/engine/crawl';
import { resolveSettings } from '../../../src/shared/settings';

const rec = (url: string, over: Partial<CrawlRecord>): CrawlRecord => ({
  url, finalUrl: url, kind: 'other', isPage: false, depth: 0, fetched: true, status: 200, bytes: 0, referrers: [], ...over,
});

describe('buildAnalysisReport', () => {
  it('summarizes pages, assets, hosts, warnings and recommendations', () => {
    const records = new Map<string, CrawlRecord>([
      ['p1', rec('https://x.com/b.html', { isPage: true, kind: 'page' })],
      ['p2', rec('https://x.com/a.html', { isPage: true, kind: 'page' })],
      ['p3', rec('https://x.com/old.html', { isPage: true, kind: 'page', duplicate: true })],
      ['c', rec('https://x.com/s.css', { kind: 'css' })],
      ['i', rec('https://x.com/i.png', { kind: 'image', fetched: false })],
      ['f', rec('https://x.com/f.png', { kind: 'image', fetched: false, error: 'Bot protection challenge (HTTP 403)', errorReason: 'challenge' })],
    ]);
    const crawl = {
      seedUrl: 'https://x.com/a.html', scope: computeScope('https://x.com/a.html'), records, aliases: new Map(),
      limitReached: true, externalHosts: new Map([['cdn.com', 3], ['fonts.com', 5]]), warnings: ['w1'],
      counters: { pagesDone: 3, pagesQueued: 3, assetsDone: 3, assetsQueued: 3, bytes: 0, errors: 1 },
    } as CrawlResult;
    const { settings } = resolveSettings({ maxPages: 10 });
    const r = buildAnalysisReport(crawl, settings, 'static', undefined);
    expect(r.pages).toEqual(['https://x.com/a.html', 'https://x.com/b.html']);
    expect(r.assetCounts).toMatchObject({ css: 1, image: 2 });
    expect(r.externalHosts).toEqual([{ host: 'fonts.com', count: 5 }, { host: 'cdn.com', count: 3 }]);
    expect(r.warnings).toContain('w1');
    expect(r.warnings.some((w) => w.includes('Bot protection'))).toBe(true);
    expect(r.recommended).toMatchObject({ maxPages: 20, concurrency: 2, requestDelayMs: 500 });
  });
});
