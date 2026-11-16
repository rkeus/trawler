import type { BlobStore, BlobWriter } from './blob-store';
import { isBotChallenge } from './challenge';
import { sleep as defaultSleep } from './sleep';
import { FetchError, type FetchImpl, type FetchedResource, type Fetcher } from './types';

export interface FetcherOptions {
  fetchImpl: FetchImpl;
  /** max wait for response headers */
  timeoutMs: number;
  /** max silence while the body streams; default timeoutMs */
  idleTimeoutMs?: number;
  /** extra attempts after the first one */
  retries: number;
  signal: AbortSignal;
  /** empty/undefined: use the fetch implementation's default */
  userAgent?: string;
  /** called on 429/503 so the caller can reduce concurrency */
  onThrottle?: () => void;
  /** cap for honoring Retry-After, default 30000 */
  maxRetryAfterMs?: number;
  /** successful bodies larger than memoryLimitBytes stream to this store (when it returns one) */
  spillTo?: () => BlobStore | undefined;
  /** default 8 MiB */
  memoryLimitBytes?: number;
  /** injectable for tests */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
/** error responses are read only far enough to recognize a challenge page */
const ERROR_BODY_LIMIT = 65536;

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

/**
 * Rejects as soon as `signal` aborts, even if the underlying promise ignores the signal.
 * `onLate` receives a value that arrives after the abort, so it can be released (e.g. cancel a response body).
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal, onLate?: (value: T) => void): Promise<T> {
  const releaseLate = (): void => {
    if (onLate) promise.then(onLate, () => undefined);
  };
  if (signal.aborted) {
    releaseLate();
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      settled = true;
      reject(signal.reason);
      releaseLate();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        if (settled) return;
        settled = true;
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        if (settled) return;
        settled = true;
        reject(e);
      },
    );
  });
}

class TimeoutReason extends Error {}

interface Body {
  body: Buffer;
  size: number;
  spilledBlobId?: string;
}

async function readBody(
  res: Response,
  ctl: AbortController,
  signal: AbortSignal,
  idleMs: number,
  spill: BlobStore | undefined,
  limit: number,
  maxBytes: number,
): Promise<Body> {
  if (!res.body) return { body: Buffer.alloc(0), size: 0 };
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  let writer: BlobWriter | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    clearTimeout(idle);
    idle = setTimeout(() => ctl.abort(new TimeoutReason(`No data for ${idleMs} ms`)), idleMs);
  };
  const spillNow = async (): Promise<void> => {
    writer = spill!.createWriter();
    for (const c of chunks) await writer.write(c);
    chunks.length = 0;
  };
  try {
    const declared = Number(res.headers.get('content-length'));
    if (spill && Number.isFinite(declared) && declared > limit) await spillNow();
    arm();
    for (;;) {
      const { done, value } = await raceAbort(reader.read(), signal);
      if (done) break;
      clearTimeout(idle); // disk writes below do not count as network silence
      size += value.byteLength;
      if (writer) await writer.write(value);
      else {
        chunks.push(Buffer.from(value));
        if (spill && size > limit) await spillNow();
      }
      if (size >= maxBytes) {
        await reader.cancel().catch(() => undefined);
        break;
      }
      arm();
    }
    if (writer) return { body: Buffer.alloc(0), size, spilledBlobId: await writer.finish() };
    return { body: Buffer.concat(chunks), size };
  } catch (err) {
    await writer?.abort();
    await reader.cancel().catch(() => undefined);
    throw err;
  } finally {
    clearTimeout(idle);
  }
}

export function createFetcher(opts: FetcherOptions): Fetcher {
  const sleep = opts.sleep ?? defaultSleep;
  const headers: Record<string, string> = opts.userAgent ? { 'user-agent': opts.userAgent } : {};
  const idleMs = opts.idleTimeoutMs ?? opts.timeoutMs;
  const limit = opts.memoryLimitBytes ?? 8 * 1024 * 1024;
  const aborted = (url: string): FetchError => new FetchError('Cancelled', url, 'aborted');

  /** Classifies a failure of one attempt: cancel, timeout (header or idle) or network. */
  const classify = (url: string, ctl: AbortController, err: unknown): FetchError => {
    if (opts.signal.aborted) return aborted(url);
    if (ctl.signal.aborted && ctl.signal.reason instanceof TimeoutReason) {
      return new FetchError(`Timed out: ${ctl.signal.reason.message}`, url, 'timeout');
    }
    return new FetchError(`Network error: ${(err as Error)?.message ?? String(err)}`, url, 'network');
  };

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

        const ctl = new AbortController();
        const signal = AbortSignal.any([opts.signal, ctl.signal]);
        const headerTimer = setTimeout(
          () => ctl.abort(new TimeoutReason(`No response within ${opts.timeoutMs} ms`)),
          opts.timeoutMs,
        );
        let res: Response;
        let body: Body;
        try {
          res = await raceAbort(opts.fetchImpl(url, { headers, redirect: 'follow', signal }), signal, (late) => {
            void late.body?.cancel().catch(() => undefined); // free the connection of a response that came too late
          });
          clearTimeout(headerTimer);
          body = await readBody(
            res,
            ctl,
            signal,
            idleMs,
            res.ok ? opts.spillTo?.() : undefined,
            limit,
            res.ok ? Number.POSITIVE_INFINITY : ERROR_BODY_LIMIT,
          );
        } catch (err) {
          clearTimeout(headerTimer);
          const e = classify(url, ctl, err);
          if (e.reason === 'aborted' || attempt >= opts.retries) throw e;
          wait = backoffMs(attempt + 1);
          continue;
        }

        const hdrs = headersToRecord(res.headers);
        if (isBotChallenge(res.status, hdrs, body.body.subarray(0, 4096).toString('latin1'))) {
          throw new FetchError(`Bot protection challenge (HTTP ${res.status})`, url, 'challenge', res.status);
        }
        if (res.ok) {
          return {
            url,
            finalUrl: res.url || url,
            status: res.status,
            contentType: hdrs['content-type'],
            headers: hdrs,
            body: body.body,
            size: body.size,
            ...(body.spilledBlobId ? { spilledBlobId: body.spilledBlobId } : {}),
          };
        }
        const e = new FetchError(`HTTP ${res.status}`, url, 'http', res.status);
        const throttled = res.status === 429 || res.status === 503;
        if (throttled) opts.onThrottle?.(); // also on the last attempt: the server is overloaded either way
        if (!RETRYABLE.has(res.status) || attempt >= opts.retries) throw e;
        wait = throttled
          ? Math.min(parseRetryAfter(hdrs['retry-after']) ?? backoffMs(attempt + 1), opts.maxRetryAfterMs ?? 30000)
          : backoffMs(attempt + 1);
      }
    },
  };
}
