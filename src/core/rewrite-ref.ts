import type { ResolveLocal } from '../shared/types';
import { relativeHref, splitFragment } from './url/href';
import { normalizeUrl } from './url/normalize';

/**
 * Computes the replacement for one URL reference found in a local file.
 * - downloaded → relative path from `fromLocalPath` (+ original fragment)
 * - not downloaded → absolute URL (+ fragment) so it still works online
 * - fragment-only, empty, template placeholders, non-http → undefined (leave as-is)
 */
export function rewriteRef(
  raw: string,
  baseUrl: string,
  fromLocalPath: string,
  resolveLocal: ResolveLocal,
): string | undefined {
  const t = raw.trim();
  if (!t || t.startsWith('#') || t.startsWith('{{')) return undefined;
  const abs = normalizeUrl(t, baseUrl);
  if (!abs) return undefined;
  const [, fragment] = splitFragment(t);
  const local = resolveLocal(abs);
  if (local !== undefined) return relativeHref(fromLocalPath, local) + fragment;
  return abs + fragment;
}
