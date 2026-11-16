import type { Capturer, MissingRef, Verifier, VerifyReport } from '../engine';

export interface BrowserVerifierOptions {
  timeoutMs: number;
  networkIdleMs: number;
}

/**
 * Loads every page of the local copy (served by the preview server) in a hidden browser and reports failed
 * same-origin requests: missing files, broken imports and failed JSON fetches, including ones made by JavaScript.
 */
export function createBrowserVerifier(capturer: Capturer, opts: BrowserVerifierOptions): Verifier {
  return {
    async verify(baseUrl: string, pages: string[], signal: AbortSignal): Promise<VerifyReport> {
      const origin = new URL(baseUrl).origin;
      const missing: MissingRef[] = [];
      let pagesOk = 0;
      for (const page of pages) {
        if (signal.aborted) break;
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
          if (signal.aborted) break;
          missing.push({ page, url: pageUrl, status: 0 });
        }
      }
      return { pagesChecked: pages.length, pagesOk, missing };
    },
  };
}
