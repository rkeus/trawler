import { extractCssRefs, extractHtmlRefs } from '../core';
import { decodeBody } from './text';
import type { FetchImpl, MissingRef, Verifier, VerifyReport } from './types';

interface Got {
  status: number;
  type?: string;
  body?: Buffer;
}

/**
 * HTTP-level verification of a local copy served by the preview server: every page must load, and every
 * same-origin asset it references (including refs inside its CSS) must return 200. JS-loaded resources are
 * not covered; the browser-based verifier in Plan 2b adds those. Redirects count as missing.
 */
export function createStaticVerifier(fetchImpl: FetchImpl): Verifier {
  return {
    async verify(baseUrl: string, pages: string[], signal: AbortSignal): Promise<VerifyReport> {
      const origin = new URL(baseUrl).origin;
      const statusCache = new Map<string, Got>();
      const missing: MissingRef[] = [];
      let pagesOk = 0;

      const get = async (url: string): Promise<Got> => {
        const cached = statusCache.get(url);
        if (cached) return cached;
        let got: Got;
        try {
          const r = await fetchImpl(url, { signal, redirect: 'manual' }); // a redirect means the file is not where the page expects it
          got = { status: r.status, type: r.headers.get('content-type') ?? undefined, body: Buffer.from(await r.arrayBuffer()) };
        } catch {
          got = { status: 0 };
        }
        statusCache.set(url, got);
        return got;
      };

      for (const page of pages) {
        if (signal.aborted) break;
        const pageUrl = new URL(page.split('/').map(encodeURIComponent).join('/'), baseUrl).href;
        const res = await get(pageUrl);
        if (res.status !== 200 || !res.body) {
          missing.push({ page, url: pageUrl, status: res.status });
          continue;
        }
        const refs = new Set<string>();
        for (const a of extractHtmlRefs(decodeBody(res.body, res.type).text, pageUrl).assets) refs.add(a.url);
        let ok = true;
        for (const url of refs) {
          if (new URL(url).origin !== origin) continue; // external refs are not part of the local copy
          const r = await get(url);
          if (r.status !== 200) {
            ok = false;
            missing.push({ page, url, status: r.status });
            continue;
          }
          if (r.body && /text\/css/i.test(r.type ?? '')) {
            for (const c of extractCssRefs(decodeBody(r.body, r.type).text, url)) refs.add(c.url);
          }
        }
        if (ok) pagesOk++;
      }
      return { pagesChecked: pages.length, pagesOk, missing };
    },
  };
}
