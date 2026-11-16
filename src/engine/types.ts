import type { AssetKind, Detection } from '../shared/types';

/** Any fetch-compatible function: Node's global fetch, or Electron's session.fetch. */
export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export interface FetchedResource {
  /** URL that was requested */
  url: string;
  /** URL after redirects */
  finalUrl: string;
  status: number;
  contentType: string | undefined;
  /** lowercased header names */
  headers: Record<string, string>;
  /** empty when the body was spilled to the blob store (see spilledBlobId) */
  body: Buffer;
  /** bytes received */
  size: number;
  /** set when a large body was streamed to the blob store instead of memory */
  spilledBlobId?: string;
}

export type FetchFailureReason = 'http' | 'network' | 'timeout' | 'aborted' | 'challenge';

export class FetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly reason: FetchFailureReason,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export interface Fetcher {
  /** Resolves with a 2xx response; rejects with FetchError otherwise. */
  fetch(url: string): Promise<FetchedResource>;
}

export interface ProgressCounters {
  pagesDone: number;
  pagesQueued: number;
  assetsDone: number;
  assetsQueued: number;
  bytes: number;
  errors: number;
}

export type JobKind = 'analyze' | 'download';
export type JobPhase = 'detecting' | 'crawling' | 'rewriting' | 'verifying' | 'done';
export type JobStatus = 'done' | 'done_with_errors' | 'cancelled' | 'failed';

export type JobEvent =
  | { type: 'phase'; phase: JobPhase }
  | { type: 'detection'; detection: Detection; mode: 'static' | 'js' }
  | { type: 'progress'; counters: ProgressCounters }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; url?: string };

export interface MissingRef {
  /** local page path (posix, relative to the output root) */
  page: string;
  url: string;
  status: number;
}

export interface VerifyReport {
  pagesChecked: number;
  pagesOk: number;
  missing: MissingRef[];
}

export interface Verifier {
  /** `baseUrl` is the preview URL of the output root (ends with "/"); `pages` are local page paths. */
  verify(baseUrl: string, pages: string[], signal: AbortSignal): Promise<VerifyReport>;
}

export interface PlacedFile {
  url: string;
  aliases: string[];
  path: string;
  status: number;
  contentType?: string;
  bytes: number;
  kind: AssetKind;
}

export interface CaptureOptions {
  timeoutMs: number;
  networkIdleMs: number;
  autoScroll: boolean;
  signal: AbortSignal;
}

/** A response observed by the browser while rendering a page. */
export interface CapturedResponse {
  url: string;
  /** URL the browser requested when it differs from `url` (redirects); lets the crawl alias it */
  requestUrl?: string;
  status: number;
  /** text bodies are delivered as UTF-8; the capturer rewrites any charset parameter to utf-8 */
  contentType?: string;
  /** undefined = omitted (above memoryBodyLimitBytes, or unavailable): the crawl fetches it with streaming. An empty Buffer is a real empty body. */
  body?: Buffer;
  /** browser resource type, e.g. Document, Stylesheet, Script, Image, Font, XHR, Fetch */
  type: string;
}

export interface CaptureResult {
  url: string;
  finalUrl: string;
  status: number;
  /** content type of the document as served; a non-HTML type means the link was a file, not a page */
  contentType?: string;
  /** raw served bytes of the document when the capturer has them (keeps legacy charsets intact) */
  body?: Buffer;
  /** the document as served (decoded text; Trawler stores it as UTF-8) */
  html: string;
  /** document.documentElement.outerHTML after rendering */
  renderedHtml: string;
  /** subresources the browser loaded (the document itself excluded) */
  resources: CapturedResponse[];
  /** XHR/fetch responses with JSON content */
  dataRequests: number;
  /** requests that failed while rendering: status >= 400, or 0 for network errors */
  failed: { url: string; status: number }[];
}

/**
 * Renders pages in a real browser. Contract:
 * - rejects promptly when `opts.signal` aborts;
 * - throws FetchError for load failures (anything else is treated as a network failure of that page);
 * - delivers text bodies as UTF-8 and sets their charset parameter to utf-8;
 * - leaves out resource bodies above the memory body limit.
 */
export interface Capturer {
  capture(url: string, opts: CaptureOptions): Promise<CaptureResult>;
}

/** Passes a bot-protection challenge in a real browser that shares the job's cookies. */
export interface ChallengeSolver {
  solve(url: string, signal: AbortSignal): Promise<boolean>;
}
