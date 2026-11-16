import {
  ALLOW_ALL,
  Frontier,
  canonicalizeScheme,
  computeScope,
  extractCssRefs,
  extractHtmlRefs,
  inScope,
  isHtmlContentType,
  kindFromUrl,
  normalizeUrl,
  shouldCrawl,
  type CrawlFilter,
  type Scope,
} from '../core';
import { compileExcludePatterns, type Settings } from '../shared/settings';
import type { AssetKind } from '../shared/types';
import type { BlobStore } from './blob-store';
import type { AdaptivePool } from './pool';
import { loadRobots } from './robots-loader';
import { decodeBody } from './text';
import {
  FetchError,
  type FetchFailureReason,
  type Fetcher,
  type FetchedResource,
  type JobEvent,
  type ProgressCounters,
} from './types';

export interface CrawlRecord {
  /** canonical requested URL (record key) */
  url: string;
  /** canonical URL after redirects */
  finalUrl: string;
  kind: AssetKind;
  isPage: boolean;
  depth: number;
  fetched: boolean;
  /** 0 when not fetched */
  status: number;
  contentType?: string;
  bytes: number;
  /** download mode */
  blobId?: string;
  /** analyze mode: pages and CSS bodies */
  body?: Buffer;
  referrers: string[];
  error?: string;
  errorReason?: FetchFailureReason;
  /** a redirect landed on a URL that already has its own record */
  duplicate?: boolean;
}

export interface CrawlOptions {
  seedUrl: string;
  settings: Settings;
  fetcher: Fetcher;
  pool: AdaptivePool;
  signal: AbortSignal;
  emit: (event: JobEvent) => void;
  /** download: store every body in the blob store; analyze: fetch only pages + CSS, keep them in memory */
  kind: 'analyze' | 'download';
  blobStore?: BlobStore;
  /** product token matched against robots.txt groups, default "trawler" */
  robotsAgent?: string;
}

export interface CrawlResult {
  /** canonical start URL after redirects */
  seedUrl: string;
  scope: Scope;
  records: Map<string, CrawlRecord>;
  /** requested URL → final URL, for redirects */
  aliases: Map<string, string>;
  limitReached: boolean;
  /** external host → distinct URLs referenced */
  externalHosts: Map<string, number>;
  warnings: string[];
  counters: ProgressCounters;
}

export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedError';
  }
}

export async function crawl(opts: CrawlOptions): Promise<CrawlResult> {
  const { settings, fetcher, pool, signal, emit } = opts;
  if (opts.kind === 'download' && !opts.blobStore) throw new Error('crawl: blobStore is required for downloads');

  const seed = normalizeUrl(opts.seedUrl);
  if (!seed) throw new SeedError(`Invalid start URL: ${opts.seedUrl}`);

  // Fetch the seed first: its final URL (after redirects such as http→https or www.) defines the scope.
  let seedRes: FetchedResource;
  try {
    seedRes = await fetcher.fetch(seed);
  } catch (err) {
    if (err instanceof FetchError) throw new SeedError(`Could not load the start URL: ${err.message}`);
    throw err;
  }
  const start = normalizeUrl(seedRes.finalUrl) ?? seed;
  const scope = computeScope(start);

  const records = new Map<string, CrawlRecord>();
  /** final URL → record, so redirect targets are not fetched again */
  const landed = new Map<string, CrawlRecord>();
  const aliases = new Map<string, string>();
  const externalHosts = new Map<string, number>();
  const externalSeen = new Set<string>();
  const warnings: string[] = [];
  const counters: ProgressCounters = { pagesDone: 0, pagesQueued: 0, assetsDone: 0, assetsQueued: 0, bytes: 0, errors: 0 };
  const tasks: Promise<void>[] = [];

  const robots = settings.respectRobotsTxt ? await loadRobots(fetcher, scope.origin, opts.robotsAgent ?? 'trawler') : ALLOW_ALL;
  const filter: CrawlFilter = { scope, exclude: compileExcludePatterns(settings.excludePatterns), robots };
  const frontier = new Frontier({ maxDepth: settings.maxDepth, maxPages: settings.maxPages });

  const canon = (u: string): string => canonicalizeScheme(u, scope);
  const isSameHost = (u: string): boolean => new URL(u).host === scope.host;
  const progress = (): void => emit({ type: 'progress', counters: { ...counters } });
  const find = (url: string): CrawlRecord | undefined => records.get(url) ?? landed.get(url);
  const newRecord = (url: string, kind: AssetKind, isPage: boolean, depth: number, referrer?: string): CrawlRecord => ({
    url,
    finalUrl: url,
    kind,
    isPage,
    depth,
    fetched: false,
    status: 0,
    bytes: 0,
    referrers: referrer ? [referrer] : [],
  });
  const addReferrer = (rec: CrawlRecord, referrer?: string): void => {
    if (referrer && !rec.referrers.includes(referrer)) rec.referrers.push(referrer);
  };

  function enqueuePage(raw: string, depth: number, referrer?: string, force = false, prefetched?: FetchedResource): void {
    if (signal.aborted) return;
    const url = canon(raw);
    const existing = find(url);
    if (existing) {
      addReferrer(existing, referrer);
      return;
    }
    if (!force && !shouldCrawl(url, filter)) return;
    if (!frontier.add(url, depth)) return;
    const rec = newRecord(url, 'page', true, depth, referrer);
    records.set(url, rec);
    counters.pagesQueued++;
    tasks.push(pool.run(() => fetchPage(rec, prefetched)));
  }

  function enqueueAsset(raw: string, kind: AssetKind, referrer: string): void {
    if (signal.aborted) return;
    const url = canon(raw);
    const existing = find(url);
    if (existing) {
      addReferrer(existing, referrer);
      return;
    }
    if (!isSameHost(url)) {
      if (!externalSeen.has(url)) {
        externalSeen.add(url);
        const host = new URL(url).host;
        externalHosts.set(host, (externalHosts.get(host) ?? 0) + 1);
      }
      if (!settings.downloadExternal) return;
    }
    const rec = newRecord(url, kind, false, 0, referrer);
    records.set(url, rec);
    counters.assetsQueued++;
    if (opts.kind === 'analyze' && kind !== 'css') {
      counters.assetsDone++; // analyze only discovers non-CSS assets
      return;
    }
    tasks.push(pool.run(() => fetchAsset(rec)));
  }

  /** Applies a response; returns false when the redirect target already has its own record. */
  function accept(rec: CrawlRecord, res: FetchedResource, final: string): boolean {
    rec.fetched = true;
    rec.status = res.status;
    rec.contentType = res.contentType;
    rec.bytes = res.body.length;
    counters.bytes += res.body.length;
    rec.finalUrl = final;
    if (final !== rec.url) {
      aliases.set(rec.url, final);
      const other = find(final);
      if (other && other !== rec) {
        rec.duplicate = true;
        return false;
      }
      landed.set(final, rec);
    }
    return true;
  }

  async function store(rec: CrawlRecord, body: Buffer, keepForAnalyze: boolean): Promise<void> {
    if (opts.kind === 'download') rec.blobId = await opts.blobStore!.put(body);
    else if (keepForAnalyze) rec.body = body;
  }

  function fail(rec: CrawlRecord, err: unknown): void {
    if (!(err instanceof FetchError)) throw err; // disk and programming errors abort the crawl
    rec.error = err.message;
    rec.errorReason = err.reason;
    rec.status = err.status ?? 0;
    if (err.reason === 'aborted') return;
    counters.errors++;
    emit({ type: 'log', level: 'warn', message: err.message, url: rec.url });
  }

  async function fetchPage(rec: CrawlRecord, prefetched?: FetchedResource): Promise<void> {
    try {
      const res = prefetched ?? (await fetcher.fetch(rec.url));
      const final = canon(normalizeUrl(res.finalUrl) ?? rec.url);
      if (final !== rec.url && !inScope(final, scope)) {
        throw new FetchError(`Redirected outside the crawl scope to ${final}`, rec.url, 'http', res.status);
      }
      if (!accept(rec, res, final)) return;
      if (!isHtmlContentType(res.contentType)) {
        // a page link that serves something else (PDF, image…): keep it as an asset
        rec.isPage = false;
        rec.kind = kindFromUrl(rec.finalUrl, res.contentType);
        await store(rec, res.body, false);
        return;
      }
      await store(rec, res.body, true);
      const { text } = decodeBody(res.body, res.contentType);
      const parsed = extractHtmlRefs(text, rec.finalUrl);
      for (const a of parsed.assets) enqueueAsset(a.url, a.kind, rec.finalUrl);
      for (const p of parsed.pages) enqueuePage(p.url, rec.depth + 1, rec.finalUrl);
    } catch (err) {
      fail(rec, err);
    } finally {
      counters.pagesDone++;
      progress();
    }
  }

  async function fetchAsset(rec: CrawlRecord): Promise<void> {
    try {
      const res = await fetcher.fetch(rec.url);
      const final = canon(normalizeUrl(res.finalUrl) ?? rec.url);
      if (!accept(rec, res, final)) return;
      const kind = kindFromUrl(rec.finalUrl, res.contentType);
      // keep a "css" hint when the server labels the stylesheet as plain text/data
      if (kind !== 'other' && !(rec.kind === 'css' && kind === 'data')) rec.kind = kind;
      const isCss = rec.kind === 'css';
      await store(rec, res.body, isCss);
      if (isCss) {
        const { text } = decodeBody(res.body, res.contentType);
        for (const ref of extractCssRefs(text, rec.finalUrl)) enqueueAsset(ref.url, ref.kind, rec.finalUrl);
      }
    } catch (err) {
      fail(rec, err);
    } finally {
      counters.assetsDone++;
      progress();
    }
  }

  const startPath = new URL(start).pathname + new URL(start).search;
  if (!robots.isAllowed(startPath)) {
    warnings.push('robots.txt disallows the start URL; it was fetched anyway because you asked for it.');
  }
  if (start !== seed) aliases.set(seed, start);
  enqueuePage(start, 0, undefined, true, seedRes);
  for (const extra of settings.extraSeeds) {
    const n = normalizeUrl(extra);
    if (n) enqueuePage(n, 0, undefined, true);
  }

  while (tasks.length > 0) await Promise.all(tasks.splice(0));

  if (frontier.limitReached) {
    warnings.push(`Page limit reached (${settings.maxPages}); some pages were not downloaded.`);
  }
  return {
    seedUrl: canon(start),
    scope,
    records,
    aliases,
    limitReached: frontier.limitReached,
    externalHosts,
    warnings,
    counters,
  };
}
