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
  body: Buffer;
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
