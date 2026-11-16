import type { ResolveLocal } from '../../shared/types';
import { rewriteRef } from '../rewrite-ref';
import { walkCss } from './walk-css';

export function rewriteCss(css: string, cssUrl: string, cssLocalPath: string, resolveLocal: ResolveLocal): string {
  return walkCss(css, (raw) => rewriteRef(raw, cssUrl, cssLocalPath, resolveLocal));
}
