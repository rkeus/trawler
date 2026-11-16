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
import { AdaptivePool } from './pool';
import { loadRobots } from './robots-loader';
import { decodeBody, type DecodedText } from './text';
import {
  FetchError,
  type CaptureOptions,
  type CaptureResult,
  type CapturedResponse,
  type Capturer,
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
  /** deliberately not downloaded (not an error), e.g. a redirect outside the scope */
  skipped?: string;
}

/** The start URL after its redirects; computed before the output folder is touched. */
export interface ResolvedSeed {
  /** normalized URL the user gave */
  requested: string;
  /** normalized final URL; defines the crawl scope */
  start: string;
  response: FetchedResource;
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
  /** from resolveSeed(); fetched here when omitted */
  seed?: ResolvedSeed;
  /** "js" renders pages with `capturer`; default "static" */
  mode?: 'static' | 'js';
  capturer?: Capturer;
  /** a render of the start page made during detection; reused instead of rendering twice */
  seedCapture?: CaptureResult;
  /** called once when the crawl halts on a fatal error, so the caller can abort requests in flight */
  onHalt?: () => void;
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
  /** why the start URL failed (e.g. "challenge" lets the desktop runtime try its browser) */
  readonly reason?: FetchFailureReason;

  constructor(message: string, cause?: FetchError) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SeedError';
    this.reason = cause?.reason;
  }
}

/** Fetches the start URL. Cancellation is rethrown as the aborted FetchError, other failures as SeedError. */
export async function resolveSeed(fetcher: Fetcher, seedUrl: string): Promise<ResolvedSeed> {
  const requested = normalizeUrl(seedUrl);
  if (!requested) throw new SeedError(`Invalid start URL: ${seedUrl}`);
  try {
    const response = await fetcher.fetch(requested);
    return { requested, start: normalizeUrl(response.finalUrl) ?? requested, response };
  } catch (err) {
    if (err instanceof FetchError && err.reason !== 'aborted') {
      throw new SeedError(`Could not load the start URL: ${err.message}`, err);
    }
    throw err;
  }
}

export async function crawl(opts: CrawlOptions): Promise<CrawlResult> {
  const { settings, fetcher, pool, signal, emit } = opts;
  const mode = opts.mode ?? 'static';
  if (opts.kind === 'download' && !opts.blobStore) throw new Error('crawl: blobStore is required for downloads');
  if (mode === 'js' && !opts.capturer) throw new Error('crawl: a capturer is required in JS mode');

  const seed = opts.seed ?? (await resolveSeed(fetcher, opts.seedUrl));
  const scope = computeScope(seed.start);

  const records = new Map<string, CrawlRecord>();
  /** final URL → record, so redirect targets are not fetched again */
  const landed = new Map<string, CrawlRecord>();
  const aliases = new Map<string, string>();
  const externalHosts = new Map<string, number>();
  const externalSeen = new Set<string>();
  const warnings: string[] = [];
  const counters: ProgressCounters = { pagesDone: 0, pagesQueued: 0, assetsDone: 0, assetsQueued: 0, bytes: 0, errors: 0 };
  const tasks: Promise<void>[] = [];
  let outOfScopeRedirects = 0;
  const renderPool = new AdaptivePool({ concurrency: settings.renderConcurrency });
  let rendersStarted = 0;

  // `halt` stops new work on cancel or on the first fatal (non-network) error, e.g. a full disk.
  const halt = new AbortController();
  const onAbort = (): void => halt.abort();
  if (signal.aborted) halt.abort();
  else signal.addEventListener('abort', onAbort, { once: true });
  let fatal: { error: unknown } | undefined;

  const robots = settings.respectRobotsTxt ? await loadRobots(fetcher, scope.origin, opts.robotsAgent ?? 'trawler') : ALLOW_ALL;
  const filter: CrawlFilter = { scope, exclude: compileExcludePatterns(settings.excludePatterns), robots };
  const frontier = new Frontier({ maxDepth: settings.maxDepth, maxPages: settings.maxPages });

  const canon = (u: string): string => canonicalizeScheme(u, scope);
  const isSameHost = (u: string): boolean => new URL(u).host === scope.host;
  const progress = (): void => emit({ type: 'progress', counters: { ...counters } });
  const find = (url: string): CrawlRecord | undefined => records.get(url) ?? landed.get(url);
  const halted = (): boolean => halt.signal.aborted;
  const shouldRender = (): boolean =>
    mode === 'js' && (opts.kind === 'download' || rendersStarted < settings.analyzeRenderPages);
  const captureOptions = (): CaptureOptions => ({
    timeoutMs: settings.renderTimeoutMs,
    networkIdleMs: settings.networkIdleMs,
    autoScroll: settings.autoScroll,
    signal: halt.signal,
  });
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

  /** Counts an external URL; returns false when external downloads are off. */
  function allowExternal(url: string): boolean {
    if (!externalSeen.has(url)) {
      externalSeen.add(url);
      const host = new URL(url).host;
      externalHosts.set(host, (externalHosts.get(host) ?? 0) + 1);
    }
    return settings.downloadExternal;
  }

  function enqueuePage(
    raw: string,
    depth: number,
    referrer?: string,
    force = false,
    prefetched?: FetchedResource,
    prefetchedCapture?: CaptureResult,
  ): CrawlRecord | undefined {
    if (halted()) return undefined;
    const url = canon(raw);
    const existing = find(url);
    if (existing) {
      addReferrer(existing, referrer);
      return existing;
    }
    if (!force && !shouldCrawl(url, filter)) return undefined;
    if (!frontier.add(url, depth)) return undefined;
    const rec = newRecord(url, 'page', true, depth, referrer);
    records.set(url, rec);
    counters.pagesQueued++;
    tasks.push(pool.run(() => fetchPage(rec, prefetched, prefetchedCapture), halt.signal));
    return rec;
  }

  function enqueueAsset(raw: string, kind: AssetKind, referrer: string): void {
    if (halted()) return;
    const url = canon(raw);
    const existing = find(url);
    if (existing) {
      addReferrer(existing, referrer);
      return;
    }
    if (!isSameHost(url) && !allowExternal(url)) return;
    const rec = newRecord(url, kind, false, 0, referrer);
    records.set(url, rec);
    counters.assetsQueued++;
    if (opts.kind === 'analyze' && kind !== 'css') {
      counters.assetsDone++; // analyze only discovers non-CSS assets
      return;
    }
    tasks.push(pool.run(() => fetchAsset(rec), halt.signal));
  }

  /** Applies a response; returns false when the redirect target already has its own record. */
  function accept(rec: CrawlRecord, res: FetchedResource, final: string): boolean {
    rec.fetched = true;
    rec.status = res.status;
    rec.contentType = res.contentType;
    rec.bytes = res.size;
    counters.bytes += res.size;
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

  async function store(rec: CrawlRecord, res: FetchedResource, keepForAnalyze: boolean): Promise<void> {
    if (res.spilledBlobId) {
      rec.blobId = res.spilledBlobId;
      return;
    }
    if (opts.kind === 'download') rec.blobId = await opts.blobStore!.put(res.body);
    else if (keepForAnalyze) rec.body = res.body;
  }

  async function textOf(res: FetchedResource): Promise<DecodedText> {
    const body = res.spilledBlobId ? await opts.blobStore!.get(res.spilledBlobId) : res.body;
    return decodeBody(body, res.contentType);
  }

  /** Records a per-URL failure. Anything that is not a FetchError is fatal: it halts the whole crawl. */
  function fail(rec: CrawlRecord, err: unknown): void {
    if (!(err instanceof FetchError)) {
      if (!fatal) {
        fatal = { error: err };
        opts.onHalt?.();
      }
      halt.abort();
      return;
    }
    rec.error = err.message;
    rec.errorReason = err.reason;
    rec.status = err.status ?? 0;
    if (err.reason === 'aborted') return;
    counters.errors++;
    emit({ type: 'log', level: 'warn', message: err.message, url: rec.url });
  }

  const cancelled = (url: string): FetchError => new FetchError('Cancelled', url, 'aborted');

  async function render(rec: CrawlRecord): Promise<CaptureResult> {
    rendersStarted++;
    try {
      return await renderPool.run(() => opts.capturer!.capture(rec.url, captureOptions()), halt.signal);
    } catch (err) {
      if (err instanceof FetchError) throw err;
      throw new FetchError(`Rendering failed: ${err instanceof Error ? err.message : String(err)}`, rec.url, 'network');
    }
  }

  /** Adopts a response the browser already loaded, so it is not fetched again. */
  async function adopt(r: CapturedResponse, referrer: string): Promise<void> {
    if (halted() || r.status < 200 || r.status >= 300) return;
    const n = normalizeUrl(r.url);
    if (!n) return;
    const url = canon(n);
    if (find(url)) return;
    if (!isSameHost(url) && !allowExternal(url)) return;
    const kind = kindFromUrl(url, r.contentType);
    if (kind === 'page') return; // documents (iframes) are crawled as pages
    const rec = newRecord(url, kind, false, 0, referrer);
    records.set(url, rec);
    counters.assetsQueued++;
    const res: FetchedResource = {
      url,
      finalUrl: url,
      status: r.status,
      contentType: r.contentType,
      headers: {},
      body: r.body,
      size: r.body.length,
    };
    accept(rec, res, url);
    await store(rec, res, kind === 'css');
    if (kind === 'css') {
      for (const ref of extractCssRefs(decodeBody(r.body, r.contentType).text, url)) enqueueAsset(ref.url, ref.kind, url);
    }
    counters.assetsDone++;
  }

  async function handleCapture(rec: CrawlRecord, cap: CaptureResult): Promise<void> {
    const final = canon(normalizeUrl(cap.finalUrl) ?? rec.url);
    if (final !== rec.url && !inScope(final, scope)) {
      rec.skipped = `Redirects outside the crawl scope to ${final}`;
      outOfScopeRedirects++;
      return;
    }
    if (cap.status >= 400) throw new FetchError(`HTTP ${cap.status}`, rec.url, 'http', cap.status);
    const body = Buffer.from(cap.html, 'utf8');
    const res: FetchedResource = {
      url: rec.url,
      finalUrl: cap.finalUrl,
      status: cap.status,
      contentType: 'text/html; charset=utf-8',
      headers: {},
      body,
      size: body.length,
    };
    if (!accept(rec, res, final)) return;
    await store(rec, res, true);
    for (const r of cap.resources) await adopt(r, rec.finalUrl);
    // refs from the served document plus the rendered DOM (JS-inserted images, SPA links)
    const served = extractHtmlRefs(cap.html, rec.finalUrl);
    const live = extractHtmlRefs(cap.renderedHtml, rec.finalUrl);
    for (const a of [...served.assets, ...live.assets]) enqueueAsset(a.url, a.kind, rec.finalUrl);
    for (const p of [...served.pages, ...live.pages]) enqueuePage(p.url, rec.depth + 1, rec.finalUrl);
  }

  async function fetchPage(rec: CrawlRecord, prefetched?: FetchedResource, prefetchedCapture?: CaptureResult): Promise<void> {
    try {
      if (!prefetched && !prefetchedCapture && halted()) throw cancelled(rec.url);
      if (prefetchedCapture || shouldRender()) {
        await handleCapture(rec, prefetchedCapture ?? (await render(rec)));
        return;
      }
      const res = prefetched ?? (await fetcher.fetch(rec.url));
      const final = canon(normalizeUrl(res.finalUrl) ?? rec.url);
      if (final !== rec.url && !inScope(final, scope)) {
        rec.skipped = `Redirects outside the crawl scope to ${final}`;
        outOfScopeRedirects++;
        return;
      }
      if (!accept(rec, res, final)) return;
      if (!isHtmlContentType(res.contentType)) {
        // a page link that serves something else (PDF, image…): keep it as an asset
        rec.isPage = false;
        rec.kind = kindFromUrl(rec.finalUrl, res.contentType);
        await store(rec, res, false);
        return;
      }
      await store(rec, res, true);
      const { text } = await textOf(res);
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
      if (halted()) throw cancelled(rec.url);
      const res = await fetcher.fetch(rec.url);
      const final = canon(normalizeUrl(res.finalUrl) ?? rec.url);
      if (!settings.downloadExternal && !isSameHost(final)) {
        rec.skipped = `Redirects to an external host (${new URL(final).host})`;
        return;
      }
      if (!accept(rec, res, final)) return;
      const kind = kindFromUrl(rec.finalUrl, res.contentType);
      // keep a "css" hint when the server labels the stylesheet as plain text/data
      if (kind !== 'other' && !(rec.kind === 'css' && kind === 'data')) rec.kind = kind;
      const isCss = rec.kind === 'css';
      await store(rec, res, isCss);
      if (isCss) {
        const { text } = await textOf(res);
        for (const ref of extractCssRefs(text, rec.finalUrl)) enqueueAsset(ref.url, ref.kind, rec.finalUrl);
      }
    } catch (err) {
      fail(rec, err);
    } finally {
      counters.assetsDone++;
      progress();
    }
  }

  const start = canon(seed.start);
  const requested = canon(seed.requested);
  const startUrl = new URL(start);
  if (!robots.isAllowed(startUrl.pathname + startUrl.search)) {
    warnings.push('robots.txt disallows the start URL; it was fetched anyway because you asked for it.');
  }
  const startRec = enqueuePage(start, 0, undefined, true, seed.response, opts.seedCapture);
  if (startRec && requested !== start) {
    aliases.set(requested, start);
    landed.set(requested, startRec); // a later link to the pre-redirect URL is not fetched again
  }
  // extra seeds follow the normal rules (scope, robots, excludes), only their depth is 0
  for (const extra of settings.extraSeeds) {
    const n = normalizeUrl(extra);
    if (n) enqueuePage(n, 0);
  }

  try {
    while (tasks.length > 0) await Promise.allSettled(tasks.splice(0));
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  if (fatal) throw fatal.error;

  if (outOfScopeRedirects > 0) {
    warnings.push(`${outOfScopeRedirects} link(s) redirect outside the crawl scope; they stay online links.`);
  }
  if (frontier.limitReached) {
    warnings.push(`Page limit reached (${settings.maxPages}); some pages were not downloaded.`);
  }
  return {
    seedUrl: start,
    scope,
    records,
    aliases,
    limitReached: frontier.limitReached,
    externalHosts,
    warnings,
    counters,
  };
}
