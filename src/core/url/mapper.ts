import path from 'node:path';
import { shortHash } from './hash';
import { extFromContentType, isHtmlContentType, SERVER_PAGE_EXTS } from './mime';
import { sanitizeSegment } from './sanitize';

export interface UrlMapperOptions {
  /** e.g. "https://x.com" — URLs on the same host (any scheme) map below the output root */
  origin: string;
  /** local root path on the server, e.g. "/html/" (see computeRootPath) */
  rootPath: string;
  /** relative paths longer than this move to _misc/ (default 180) */
  maxRelativeLength?: number;
}

const JS_EXTS = new Set(['.js', '.mjs', '.cjs']);
const MAX_ALIAS_HOPS = 10;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** "a.css" + "abc123" → "a.__q-abc123.css"; "data" → "data.__q-abc123" */
function addSuffix(relPath: string, hash: string): string {
  const dir = path.posix.dirname(relPath);
  const base = path.posix.basename(relPath);
  const ext = path.posix.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  const name = `${stem}.__q-${hash}${ext}`;
  return dir === '.' ? name : `${dir}/${name}`;
}

/**
 * Maps absolute URLs to unique, Windows-safe local paths (posix separators, relative to the output root).
 *
 * - Same host (scheme-insensitive) → below the output root; other hosts → vendor/<host>/.
 * - First URL to claim a path wins; later different URLs get a hash suffix. Callers must therefore call
 *   map() in a stable order (the finalizer sorts URLs) to get identical names on every run.
 * - Redirects: map() the final URL, then alias(originalUrl, finalUrl) so get(originalUrl) resolves.
 * Stateful: use one instance per job.
 */
export class UrlMapper {
  private readonly byUrl = new Map<string, string>();
  private readonly aliases = new Map<string, string>();
  /** lowercased file path → url */
  private readonly files = new Map<string, string>();
  /** lowercased directory paths */
  private readonly dirs = new Set<string>();
  private readonly host: string;
  private readonly rootPath: string;
  private readonly maxLen: number;

  constructor(opts: UrlMapperOptions) {
    this.host = new URL(opts.origin).host;
    this.rootPath = opts.rootPath.endsWith('/') ? opts.rootPath : `${opts.rootPath}/`;
    this.maxLen = opts.maxRelativeLength ?? 180;
  }

  /** Local path for a mapped URL, following redirect aliases. */
  get(url: string): string | undefined {
    let current = url;
    for (let hop = 0; hop <= MAX_ALIAS_HOPS; hop++) {
      const direct = this.byUrl.get(current);
      if (direct !== undefined) return direct;
      const next = this.aliases.get(current);
      if (next === undefined) return undefined;
      current = next;
    }
    return undefined;
  }

  /** Records that `fromUrl` redirected to `toUrl`. */
  alias(fromUrl: string, toUrl: string): void {
    if (fromUrl !== toUrl) this.aliases.set(fromUrl, toUrl);
  }

  entries(): IterableIterator<[string, string]> {
    return this.byUrl.entries();
  }

  /**
   * Local directory ('' = output root, no trailing slash) for the directory part of a same-host URL under
   * the root; undefined for other hosts or paths outside the root.
   */
  localDir(url: string): string | undefined {
    const u = new URL(url);
    if (u.host !== this.host) return undefined;
    const dir = u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1);
    if (!dir.startsWith(this.rootPath)) return undefined;
    const rel = dir.slice(this.rootPath.length, -1);
    if (rel === '') return '';
    return rel.split('/').map(safeDecode).map(sanitizeSegment).join('/');
  }

  map(url: string, contentType?: string): string {
    const existing = this.byUrl.get(url);
    if (existing !== undefined) return existing;

    let base = this.candidate(url, contentType);
    if (base.length > this.maxLen || this.ancestorIsFile(base)) {
      base = `_misc/${shortHash(url, 10)}/${path.posix.basename(base)}`;
    }
    let candidate = base;
    let attempt = 0;
    while (this.isTaken(candidate)) {
      attempt++;
      candidate = addSuffix(base, shortHash(attempt === 1 ? url : `${url}#${attempt}`, 6));
    }
    this.claim(candidate, url);
    return candidate;
  }

  private candidate(url: string, contentType?: string): string {
    const u = new URL(url);
    let prefix: string[];
    let rel: string;
    if (u.host === this.host) {
      if (u.pathname.startsWith(this.rootPath)) {
        prefix = [];
        rel = u.pathname.slice(this.rootPath.length);
      } else {
        prefix = ['_outside'];
        rel = u.pathname.slice(1);
      }
    } else {
      const host = u.hostname.replace(/\.$/, '') + (u.port ? `_${u.port}` : '');
      prefix = ['vendor', sanitizeSegment(host)];
      rel = u.pathname.slice(1);
    }

    const segs = rel.split('/').map(safeDecode);
    if (segs[segs.length - 1] === '') segs[segs.length - 1] = 'index.html';

    const i = segs.length - 1;
    const last = segs[i]!;
    const ext = path.posix.extname(last).toLowerCase();
    const stem = last.slice(0, last.length - ext.length);
    const ctExt = extFromContentType(contentType);

    if (isHtmlContentType(contentType)) {
      if (SERVER_PAGE_EXTS.has(ext)) segs[i] = `${stem}.html`;
      else if (ext !== '.html' && ext !== '.htm') segs.push('index.html');
    } else if (ctExt) {
      if (ext === '') segs[i] = last + ctExt;
      else if (SERVER_PAGE_EXTS.has(ext)) segs[i] = stem + ctExt;
      else if (ctExt === '.css' && ext !== '.css') segs[i] = last + ctExt;
      else if (ctExt === '.js' && !JS_EXTS.has(ext)) segs[i] = last + ctExt;
    }

    return [...prefix, ...segs.map(sanitizeSegment)].join('/');
  }

  private isTaken(p: string): boolean {
    const k = p.toLowerCase();
    return this.files.has(k) || this.dirs.has(k);
  }

  private ancestorIsFile(p: string): boolean {
    const parts = p.toLowerCase().split('/');
    for (let i = 1; i < parts.length; i++) {
      if (this.files.has(parts.slice(0, i).join('/'))) return true;
    }
    return false;
  }

  private claim(p: string, url: string): void {
    const k = p.toLowerCase();
    this.files.set(k, url);
    const parts = k.split('/');
    for (let i = 1; i < parts.length; i++) this.dirs.add(parts.slice(0, i).join('/'));
    this.byUrl.set(url, p);
  }
}
