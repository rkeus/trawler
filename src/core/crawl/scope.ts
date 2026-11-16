import path from 'node:path';
import { isPageExt } from '../url/mime';
import type { RobotsRules } from './robots';

export interface Scope {
  origin: string;
  /** host[:port] — scope and mapping are scheme-insensitive */
  host: string;
  /** directory of the seed URL, always ends with "/" */
  basePath: string;
}

export interface CrawlFilter {
  scope: Scope;
  exclude: RegExp[];
  robots?: RobotsRules;
}

export function computeScope(seedUrl: string): Scope {
  const u = new URL(seedUrl);
  const p = u.pathname;
  const basePath = p.endsWith('/') ? p : p.slice(0, p.lastIndexOf('/') + 1);
  return { origin: u.origin, host: u.host, basePath };
}

export function inScope(url: string, scope: Scope): boolean {
  const u = new URL(url);
  return u.host === scope.host && u.pathname.startsWith(scope.basePath);
}

export function isPageLike(url: string): boolean {
  const pathname = new URL(url).pathname;
  if (pathname.endsWith('/')) return true;
  return isPageExt(path.posix.extname(pathname).toLowerCase());
}

export function shouldCrawl(url: string, filter: CrawlFilter): boolean {
  if (!inScope(url, filter.scope) || !isPageLike(url)) return false;
  if (filter.exclude.some((re) => re.test(url))) return false;
  if (filter.robots) {
    const u = new URL(url);
    if (!filter.robots.isAllowed(u.pathname + u.search)) return false;
  }
  return true;
}
