import type { Ref } from '../../shared/types';
import { kindFromUrl } from '../url/mime';
import { normalizeUrl } from '../url/normalize';
import { walkCss } from './walk-css';

/** Absolute, deduped URL refs found in a stylesheet. */
export function extractCssRefs(css: string, cssUrl: string): Ref[] {
  const out = new Map<string, Ref>();
  walkCss(css, (raw, source) => {
    const t = raw.trim();
    if (!t || t.startsWith('#')) return undefined;
    const url = normalizeUrl(t, cssUrl);
    if (!url || out.has(url)) return undefined;
    out.set(url, { url, raw, kind: source === 'css-import' ? 'css' : kindFromUrl(url), source });
    return undefined;
  });
  return [...out.values()];
}
