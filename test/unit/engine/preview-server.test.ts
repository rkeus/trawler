import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startPreviewServer, type PreviewServer } from '../../../src/engine/preview-server';
import { makeTmpDir } from '../../helpers/tmp';

let dir: string;
let preview: PreviewServer;

beforeAll(async () => {
  dir = await makeTmpDir('prev');
  await fs.mkdir(path.join(dir, 'blog'), { recursive: true });
  await fs.mkdir(path.join(dir, 'img'), { recursive: true });
  await fs.mkdir(path.join(dir, '_trawler'), { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), '<h1>home</h1>');
  await fs.writeFile(path.join(dir, 'blog', 'index.html'), '<h1>blog</h1>');
  await fs.writeFile(path.join(dir, 'img', 'my photo.png'), 'PNG');
  await fs.writeFile(path.join(dir, '_trawler', 'manifest.json'), '{}');
  preview = await startPreviewServer({ root: dir, basePath: '/html/' });
});
afterAll(() => preview.close());

const get = (p: string) => fetch(`${preview.origin}${p}`, { redirect: 'manual' });

describe('preview server', () => {
  it('binds to localhost and exposes the base URL', () => {
    expect(preview.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(preview.url).toBe(`${preview.origin}/html/`);
  });

  it('serves files with content types under the base path', async () => {
    const r = await get('/html/img/my%20photo.png');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(await r.text()).toBe('PNG');
  });

  it('serves directory index.html and SPA fallback for extensionless routes', async () => {
    expect(await (await get('/html/')).text()).toBe('<h1>home</h1>');
    expect(await (await get('/html/blog/')).text()).toBe('<h1>blog</h1>');
    expect(await (await get('/html/blog/some/route')).text()).toBe('<h1>blog</h1>');
    expect(await (await get('/html/app/route')).text()).toBe('<h1>home</h1>');
  });

  it('404s missing files, _trawler and traversal attempts', async () => {
    expect((await get('/html/img/missing.png')).status).toBe(404);
    expect((await get('/html/_trawler/manifest.json')).status).toBe(404);
    expect((await get('/html/_TRAWLER/manifest.json')).status).toBe(404);
    expect((await get('/html/..%2F..%2Fsecret.txt')).status).toBe(404);
  });

  it('redirects paths outside the base to the base', async () => {
    const r = await get('/elsewhere');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/html/');
  });
});

describe('preview server with an encoded base path', () => {
  it('serves under a base path that contains percent-encoded characters', async () => {
    const dir2 = await makeTmpDir('prev2');
    await fs.writeFile(path.join(dir2, 'index.html'), 'ok');
    const p = await startPreviewServer({ root: dir2, basePath: '/my%20site/' });
    try {
      const r = await fetch(`${p.origin}/my%20site/index.html`, { redirect: 'manual' });
      expect(r.status).toBe(200);
      expect(await r.text()).toBe('ok');
    } finally {
      await p.close();
    }
  });
});
