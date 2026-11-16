/**
 * Resolves `raw` against `base` and returns a normalized absolute http(s) URL without fragment.
 * Host is lowercased and default ports dropped (WHATWG URL does this). Query is kept.
 * Returns null for non-http(s) schemes and unparsable input.
 */
export function normalizeUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = base !== undefined ? new URL(raw.trim(), base) : new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  return u.href;
}
