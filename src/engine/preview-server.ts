import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { contentTypeForPath } from './content-type';
import { isInside } from './output-dir';

export interface PreviewOptions {
  /** output folder */
  root: string;
  /** server path the copy is served under, e.g. "/html/" (manifest basePath, URL-encoded) */
  basePath: string;
  /** default 0 = any free port */
  port?: number;
}

export interface PreviewServer {
  /** e.g. "http://127.0.0.1:5123" */
  origin: string;
  /** origin + basePath */
  url: string;
  close(): Promise<void>;
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Resolves a request path (relative to the root) to a file, with index.html and SPA fallback. */
async function resolveFile(root: string, rel: string): Promise<string | undefined> {
  const target = path.resolve(root, rel);
  if (target !== root && !isInside(root, target)) return undefined;
  if (await isFile(target)) return target;
  if (await isDir(target)) {
    const index = path.join(target, 'index.html');
    if (await isFile(index)) return index;
  }
  if (path.extname(rel) !== '') return undefined;
  // SPA fallback: nearest index.html walking up from the requested path
  let dir = (await isDir(target)) ? target : path.dirname(target);
  for (;;) {
    const index = path.join(dir, 'index.html');
    if (await isFile(index)) return index;
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent !== root && !isInside(root, parent)) break;
    dir = parent;
  }
  return undefined;
}

/** Serves a downloaded copy on 127.0.0.1 under its original base path. */
export async function startPreviewServer(opts: PreviewOptions): Promise<PreviewServer> {
  const root = path.resolve(opts.root);
  const base = opts.basePath.endsWith('/') ? opts.basePath : `${opts.basePath}/`;
  const decodedBase = safeDecode(base); // request paths are compared after decoding

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405).end();
          return;
        }
        let pathname: string;
        try {
          pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
        } catch {
          res.writeHead(400).end();
          return;
        }
        if (!pathname.startsWith(decodedBase)) {
          res.writeHead(302, { location: base }).end();
          return;
        }
        const rel = pathname.slice(decodedBase.length);
        const lower = rel.toLowerCase(); // Windows file names are case-insensitive
        if (lower === '_trawler' || lower.startsWith('_trawler/')) {
          res.writeHead(404).end('Not found');
          return;
        }
        const file = await resolveFile(root, rel);
        if (!file) {
          res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
          return;
        }
        const { size } = await fs.stat(file);
        res.writeHead(200, { 'content-type': contentTypeForPath(file), 'content-length': size, 'cache-control': 'no-store' });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        // pipeline() handles read errors (file deleted or locked meanwhile) without crashing the process
        pipeline(createReadStream(file), res, () => undefined);
      } catch {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    url: `${origin}${base}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
