import { isBotChallenge } from './challenge';
import { sleep as defaultSleep } from './sleep';
import { FetchError, type FetchImpl, type FetchedResource, type Fetcher } from './types';

export interface FetcherOptions {
  fetchImpl: FetchImpl;
  timeoutMs: number;
  /** extra attempts after the first one */
  retries: number;
  signal: AbortSignal;
  /** empty/undefined → use the fetch implementation's default */
  userAgent?: string;
  /** called on 429/503 so the caller can reduce concurrency */
  onThrottle?: () => void;
  /** cap for honoring Retry-After, default 30000 */
  maxRetryAfterMs?: number;
  /** injectable for tests */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/** 500 ms, then 2000 ms (cap). `attempt` is 1-based. */
export function backoffMs(attempt: number): number {
  return Math.min(2000, 500 * 4 ** (attempt - 1));
}

export function parseRetryAfter(value: string | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function createFetcher(opts: FetcherOptions): Fetcher {
  const sleep = opts.sleep ?? defaultSleep;
  const headers: Record<string, string> = opts.userAgent ? { 'user-agent': opts.userAgent } : {};
  const aborted = (url: string): FetchError => new FetchError('Cancelled', url, 'aborted');

  return {
    async fetch(url: string): Promise<FetchedResource> {
      let wait = 0;
      for (let attempt = 0; ; attempt++) {
        if (wait > 0) {
          try {
            await sleep(wait, opts.signal);
          } catch {
            throw aborted(url);
          }
        }
        if (opts.signal.aborted) throw aborted(url);

        const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs)]);
        let res: Response;
        let body: Buffer;
        try {
          res = await opts.fetchImpl(url, { headers, redirect: 'follow', signal });
          body = Buffer.from(await res.arrayBuffer());
        } catch (err) {
          if (opts.signal.aborted) throw aborted(url);
          const timedOut = signal.aborted;
          const e = new FetchError(
            timedOut ? `Timed out after ${opts.timeoutMs} ms` : `Network error: ${(err as Error).message}`,
            url,
            timedOut ? 'timeout' : 'network',
          );
          if (attempt >= opts.retries) throw e;
          wait = backoffMs(attempt + 1);
          continue;
        }

        const hdrs = headersToRecord(res.headers);
        if (isBotChallenge(res.status, hdrs, body.subarray(0, 4096).toString('latin1'))) {
          throw new FetchError(`Bot protection challenge (HTTP ${res.status})`, url, 'challenge', res.status);
        }
        if (res.ok) {
          return { url, finalUrl: res.url || url, status: res.status, contentType: hdrs['content-type'], headers: hdrs, body };
        }
        const e = new FetchError(`HTTP ${res.status}`, url, 'http', res.status);
        if (!RETRYABLE.has(res.status) || attempt >= opts.retries) throw e;
        if (res.status === 429 || res.status === 503) {
          opts.onThrottle?.();
          wait = Math.min(parseRetryAfter(hdrs['retry-after']) ?? backoffMs(attempt + 1), opts.maxRetryAfterMs ?? 30000);
        } else {
          wait = backoffMs(attempt + 1);
        }
      }
    },
  };
}
