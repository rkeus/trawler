import type { Capturer, MissingRef, Verifier, VerifyReport } from '../engine';

export interface BrowserVerifierOptions {
  timeoutMs: number;
  networkIdleMs: number;
  /** pages checked at once (settings.renderConcurrency) */
  concurrency: number;
}

/** beacons and CSP reports are not files of the copy */
const IGNORED_TYPES = new Set(['Ping', 'CSPViolationReport']);

/**
 * Loads every page of the local copy (served by the preview server) in a hidden browser and reports failed
 * same-origin GET requests: missing files, broken imports, failed JSON fetches, including ones made by
 * JavaScript. A same-origin redirect counts as missing, because the preview server only redirects paths that
 * are outside the copy.
 */
export function createBrowserVerifier(capturer: Capturer, opts: BrowserVerifierOptions): Verifier {
  return {
    async verify(baseUrl: string, pages: string[], signal: AbortSignal): Promise<VerifyReport> {
      const origin = new URL(baseUrl).origin;
      const missing: MissingRef[] = [];
      let pagesOk = 0;

      const check = async (page: string): Promise<void> => {
        const pageUrl = new URL(page.split('/').map(encodeURIComponent).join('/'), baseUrl).href;
        try {
          const cap = await capturer.capture(pageUrl, {
            timeoutMs: opts.timeoutMs,
            networkIdleMs: opts.networkIdleMs,
            autoScroll: false,
            signal,
          });
          const seen = new Set<string>();
          const bad = cap.failed.filter((f) => {
            if ((f.method ?? 'GET') !== 'GET' || IGNORED_TYPES.has(f.type ?? '')) return false;
            let u: URL;
            try {
              u = new URL(f.url);
            } catch {
              return false;
            }
            // the browser asks for /favicon.ico on its own; it is not part of the copy
            if (u.origin !== origin || u.pathname === '/favicon.ico' || seen.has(f.url)) return false;
            seen.add(f.url);
            return true;
          });
          for (const f of bad) missing.push({ page, url: f.url, status: f.status });
          if (bad.length === 0) pagesOk++;
        } catch {
          if (!signal.aborted) missing.push({ page, url: pageUrl, status: 0 });
        }
      };

      const queue = [...pages];
      const workers = Array.from({ length: Math.max(1, Math.min(opts.concurrency, queue.length)) }, async () => {
        while (queue.length > 0 && !signal.aborted) await check(queue.shift()!);
      });
      await Promise.all(workers);
      return { pagesChecked: pages.length, pagesOk, missing };
    },
  };
}
