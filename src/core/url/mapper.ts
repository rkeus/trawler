import path from 'node:path';
import { shortHash } from './hash';
import { extFromContentType, isHtmlContentType } from './mime';
import { sanitizeSegment } from './sanitize';

export interface UrlMapperOptions {
  /** e.g. "https://x.com" — same-origin URLs map below the output root */
  origin: string;
  /** local root path on the server, e.g. "/html/" (see computeRootPath) */
  rootPath: string;
  /** relative paths longer than this move to _misc/ (default 180) */
  maxRelativeLength?: number;
}

const SERVER_PAGE_EXTS = new Set(['.php', '.asp', '.aspx', '.jsp', '.cfm', '.cgi']);

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
 * First URL to claim a path wins; later different URLs get a hash suffix. Stateful: use one instance per job.
 */
export class UrlMapper {
  private readonly byUrl = new Map<string, string>();
  /** lowercased file path → url */
  private readonly files = new Map<string, string>();
  /** lowercased directory paths */
  private readonly dirs = new Set<string>();
  private readonly origin: string;
  private readonly rootPath: string;
  private readonly maxLen: number;

  constructor(opts: UrlMapperOptions) {
    this.origin = new URL(opts.origin).origin;
    this.rootPath = opts.rootPath.endsWith('/') ? opts.rootPath : `${opts.rootPath}/`;
    this.maxLen = opts.maxRelativeLength ?? 180;
  }

  get(url: string): string | undefined {
    return this.byUrl.get(url);
  }

  entries(): IterableIterator<[string, string]> {
    return this.byUrl.entries();
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
    if (u.origin === this.origin) {
      if (u.pathname.startsWith(this.rootPath)) {
        prefix = [];
        rel = u.pathname.slice(this.rootPath.length);
      } else {
        prefix = ['_outside'];
        rel = u.pathname.slice(1);
      }
    } else {
      prefix = ['vendor', u.host.replace(':', '_')];
      rel = u.pathname.slice(1);
    }

    const segs = rel.split('/').map(safeDecode);
    if (segs[segs.length - 1] === '') segs[segs.length - 1] = 'index.html';

    const last = segs[segs.length - 1]!;
    const ext = path.posix.extname(last).toLowerCase();
    const html = isHtmlContentType(contentType);
    if (ext === '') {
      if (html) segs.push('index.html');
      else {
        const e = extFromContentType(contentType);
        if (e) segs[segs.length - 1] = last + e;
      }
    } else if (html && SERVER_PAGE_EXTS.has(ext)) {
      segs[segs.length - 1] = `${last.slice(0, -ext.length)}.html`;
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
