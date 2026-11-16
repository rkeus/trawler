import type { ParsedHtml, Ref } from '../../shared/types';
import { kindFromUrl } from '../url/mime';
import { normalizeUrl } from '../url/normalize';
import { walkHtml } from './walk-html';

/** Absolute, deduped asset refs and page links (any origin — the crawler filters scope) in an HTML document. */
export function extractHtmlRefs(html: string, pageUrl: string): ParsedHtml {
  let base = pageUrl;
  const assets = new Map<string, Ref>();
  const pages = new Map<string, Ref>();

  walkHtml(html, (site) => {
    if (site.role === 'base') {
      const b = normalizeUrl(site.raw, pageUrl);
      if (b) base = b;
      return undefined;
    }
    const t = site.raw.trim();
    if (!t || t.startsWith('#') || t.startsWith('{{')) return undefined;
    const url = normalizeUrl(t, base);
    if (!url) return undefined;
    if (site.role === 'page') {
      if (!pages.has(url)) pages.set(url, { url, raw: site.raw, kind: 'page', source: site.source });
    } else if (!assets.has(url)) {
      assets.set(url, { url, raw: site.raw, kind: site.kindHint ?? kindFromUrl(url), source: site.source });
    }
    return undefined;
  });

  return { assets: [...assets.values()], pages: [...pages.values()] };
}
