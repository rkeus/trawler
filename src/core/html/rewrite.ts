import type { ResolveLocal } from '../../shared/types';
import { rewriteRef } from '../rewrite-ref';
import { relativeDirHref } from '../url/href';
import { normalizeUrl } from '../url/normalize';
import { walkHtml } from './walk-html';

export interface RewriteHtmlOptions {
  /**
   * Local directory ('' = output root, no trailing slash) for a same-host directory URL, or undefined.
   * When given and the first <base href> maps to a local directory, <base> is kept (relative) instead of removed.
   * Usually UrlMapper.localDir.
   */
  resolveLocalDir?: (absDirUrl: string) => string | undefined;
}

/**
 * Rewrites every URL ref in an HTML page to a relative local path (downloaded) or an absolute URL (not
 * downloaded). Lazy-load attributes are only rewritten when downloaded.
 * <base href>: kept with a relative href when its directory is local (refs then become relative to that
 * directory), otherwise removed (refs become page-relative).
 */
export function rewriteHtml(
  html: string,
  pageUrl: string,
  pageLocalPath: string,
  resolveLocal: ResolveLocal,
  opts: RewriteHtmlOptions = {},
): string {
  let base = pageUrl;
  let fromPath = pageLocalPath;
  return walkHtml(html, (site) => {
    if (site.role === 'base') {
      const b = normalizeUrl(site.raw, pageUrl);
      if (!b) return null;
      base = b;
      const localDir = opts.resolveLocalDir?.(b.slice(0, b.lastIndexOf('/') + 1));
      if (localDir === undefined) return null;
      // a virtual file inside the base directory: relativeHref() then computes paths from that directory
      fromPath = localDir === '' ? '__base__' : `${localDir}/__base__`;
      return relativeDirHref(pageLocalPath, localDir);
    }
    if (site.optional) {
      const abs = normalizeUrl(site.raw.trim(), base);
      if (!abs || resolveLocal(abs) === undefined) return undefined;
    }
    return rewriteRef(site.raw, base, fromPath, resolveLocal);
  });
}
