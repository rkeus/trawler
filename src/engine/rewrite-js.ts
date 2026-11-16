import { normalizeUrl, splitFragment } from '../core';
import type { ResolveLocal } from '../shared/types';

const QUOTED_ABSOLUTE_URL = /(["'`])(https?:\/\/[^"'`\s\\]+)\1/g;

/**
 * Opt-in (settings.rewriteJsAbsoluteUrls): replaces quoted absolute same-host URLs in JavaScript with
 * root-absolute local paths (`rootPath` + local path). The preview server serves the copy under `rootPath`,
 * so these keep working there. Other strings are left untouched.
 */
export function rewriteJsAbsoluteUrls(
  js: string,
  resolveLocal: ResolveLocal,
  isSameHost: (url: string) => boolean,
  rootPath: string,
): string {
  return js.replace(QUOTED_ABSOLUTE_URL, (match, quote: string, url: string) => {
    if (!isSameHost(url)) return match;
    const [withoutFragment, fragment] = splitFragment(url);
    const abs = normalizeUrl(withoutFragment);
    if (!abs) return match;
    const local = resolveLocal(abs);
    if (local === undefined) return match;
    const encoded = local.split('/').map(encodeURIComponent).join('/');
    return `${quote}${rootPath}${encoded}${fragment}${quote}`;
  });
}
