import path from 'node:path';
import type { AssetKind } from '../../shared/types';

const TYPE_TO_EXT: Record<string, string> = {
  'text/html': '.html',
  'application/xhtml+xml': '.html',
  'text/css': '.css',
  'text/javascript': '.js',
  'application/javascript': '.js',
  'application/x-javascript': '.js',
  'application/json': '.json',
  'application/ld+json': '.json',
  'application/manifest+json': '.webmanifest',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'text/plain': '.txt',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'font/woff': '.woff',
  'font/woff2': '.woff2',
  'font/ttf': '.ttf',
  'font/otf': '.otf',
  'application/font-woff': '.woff',
  'application/font-woff2': '.woff2',
  'application/x-font-ttf': '.ttf',
  'application/vnd.ms-fontobject': '.eot',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'application/pdf': '.pdf',
  'application/wasm': '.wasm',
};

const EXT_TO_KIND: Record<string, AssetKind> = {
  '.html': 'page', '.htm': 'page',
  '.css': 'css',
  '.js': 'js', '.mjs': 'js', '.cjs': 'js',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image',
  '.avif': 'image', '.svg': 'image', '.ico': 'image', '.bmp': 'image',
  '.woff': 'font', '.woff2': 'font', '.ttf': 'font', '.otf': 'font', '.eot': 'font',
  '.mp4': 'media', '.webm': 'media', '.ogg': 'media', '.mp3': 'media', '.wav': 'media', '.m4a': 'media', '.mov': 'media',
  '.json': 'data', '.xml': 'data', '.webmanifest': 'data', '.txt': 'data', '.csv': 'data',
};

function baseType(contentType: string | undefined): string | undefined {
  if (!contentType) return undefined;
  return contentType.split(';')[0]!.trim().toLowerCase() || undefined;
}

export function extFromContentType(contentType: string | undefined): string | undefined {
  const t = baseType(contentType);
  return t ? TYPE_TO_EXT[t] : undefined;
}

export function isHtmlContentType(contentType: string | undefined): boolean {
  const t = baseType(contentType);
  return t === 'text/html' || t === 'application/xhtml+xml';
}

export function kindFromUrl(url: string, contentType?: string): AssetKind {
  const ext = extFromContentType(contentType);
  if (ext && EXT_TO_KIND[ext]) return EXT_TO_KIND[ext]!;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return 'other';
  }
  const fromPath = path.posix.extname(pathname).toLowerCase();
  return EXT_TO_KIND[fromPath] ?? 'other';
}
