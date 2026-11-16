import type { ResolveLocal } from '../../shared/types';
import { rewriteRef } from '../rewrite-ref';
import { normalizeUrl } from '../url/normalize';
import { walkHtml } from './walk-html';

/**
 * Rewrites every URL ref in an HTML page to a path relative to `pageLocalPath` (downloaded) or an absolute
 * URL (not downloaded). Removes <base href> because all refs become file-relative.
 */
export function rewriteHtml(html: string, pageUrl: string, pageLocalPath: string, resolveLocal: ResolveLocal): string {
  let base = pageUrl;
  return walkHtml(html, (site) => {
    if (site.role === 'base') {
      const b = normalizeUrl(site.raw, pageUrl);
      if (b) base = b;
      return null;
    }
    return rewriteRef(site.raw, base, pageLocalPath, resolveLocal);
  });
}
