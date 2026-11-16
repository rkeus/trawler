import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { computeScope } from '../../../src/core';
import { BlobStore } from '../../../src/engine/blob-store';
import { finalize } from '../../../src/engine/finalize';
import { rewriteJsAbsoluteUrls } from '../../../src/engine/rewrite-js';
import type { CrawlRecord, CrawlResult } from '../../../src/engine/crawl';
import { resolveSettings } from '../../../src/shared/settings';
import { makeTmpDir } from '../../helpers/tmp';

const O = 'https://x.com';

async function setup() {
  const out = await makeTmpDir('fin');
  const blobs = new BlobStore(path.join(out, '_trawler', 'blobs'));
  await blobs.init();
  const records = new Map<string, CrawlRecord>();
  const add = async (url: string, body: string, contentType: string, kind: CrawlRecord['kind'], isPage = false, finalUrl = url) => {
    records.set(url, {
      url, finalUrl, kind, isPage, depth: 0, fetched: true, status: 200, contentType,
      bytes: body.length, blobId: await blobs.put(Buffer.from(body)), referrers: [],
    });
  };
  await add(`${O}/html/index.html`, '<a href="old.html">o</a><link rel="stylesheet" href="assets/a.css?v=1"><img src="/up/u.png"><img src="gone.png">', 'text/html', 'page', true);
  await add(`${O}/html/about.html`, '<base href="/html/"><a href="index.html">h</a>', 'text/html', 'page', true);
  await add(`${O}/html/assets/a.css?v=1`, '.a{background:url(../img/b.png)}', 'text/css', 'css');
  await add(`${O}/html/img/b.png`, 'PNG', 'image/png', 'image');
  await add(`${O}/up/u.png`, 'PNG2', 'image/png', 'image');
  await add(`${O}/html/app.js`, 'fetch("https://x.com/html/img/b.png")', 'text/javascript', 'js');
  records.set(`${O}/html/gone.png`, {
    url: `${O}/html/gone.png`, finalUrl: `${O}/html/gone.png`, kind: 'image', isPage: false, depth: 0,
    fetched: false, status: 404, bytes: 0, referrers: [], error: 'HTTP 404',
  });
  const crawl: CrawlResult = {
    seedUrl: `${O}/html/index.html`,
    scope: computeScope(`${O}/html/index.html`),
    records,
    aliases: new Map([[`${O}/html/old.html`, `${O}/html/about.html`]]),
    limitReached: false,
    externalHosts: new Map(),
    warnings: [],
    counters: { pagesDone: 2, pagesQueued: 2, assetsDone: 5, assetsQueued: 5, bytes: 0, errors: 1 },
  };
  return { out, blobs, crawl };
}

const read = (out: string, p: string) => fs.readFile(path.join(out, ...p.split('/')), 'utf8');

describe('finalize', () => {
  it('computes the root, places files and rewrites HTML/CSS', async () => {
    const { out, blobs, crawl } = await setup();
    const { settings } = resolveSettings({});
    const r = await finalize({ outputDir: out, crawl, blobStore: blobs, settings });
    expect(r.rootPath).toBe('/');
    expect(r.files.map((f) => f.path).sort()).toEqual(
      ['html/about.html', 'html/app.js', 'html/assets/a.css', 'html/img/b.png', 'html/index.html', 'up/u.png'].sort(),
    );
    const index = await read(out, 'html/index.html');
    expect(index).toContain('href="about.html"');
    expect(index).toContain('href="assets/a.css"');
    expect(index).toContain('src="../up/u.png"');
    expect(index).toContain('src="https://x.com/html/gone.png"');
    expect(await read(out, 'html/assets/a.css')).toBe('.a{background:url(../img/b.png)}');
    expect(await read(out, 'html/about.html')).toContain('<base href="./">');
    expect(await read(out, 'html/app.js')).toBe('fetch("https://x.com/html/img/b.png")');
    const about = r.files.find((f) => f.path === 'html/about.html')!;
    expect(about.aliases).toEqual([`${O}/html/old.html`]);
  });

  it('optionally rewrites absolute same-host URLs in JS', async () => {
    const { out, blobs, crawl } = await setup();
    const { settings } = resolveSettings({ rewriteJsAbsoluteUrls: true });
    await finalize({ outputDir: out, crawl, blobStore: blobs, settings });
    expect(await read(out, 'html/app.js')).toBe('fetch("/html/img/b.png")');
  });
});

describe('rewriteJsAbsoluteUrls', () => {
  it('only touches quoted same-host URLs that were downloaded', () => {
    const resolve = (u: string) => (u === 'https://x.com/a.json' ? 'data/a.json' : undefined);
    const same = (u: string) => new URL(u).host === 'x.com';
    const js = `a("https://x.com/a.json#k"); b('https://x.com/none.json'); c("https://cdn.com/x.js")`;
    expect(rewriteJsAbsoluteUrls(js, resolve, same, '/site/')).toBe(
      `a("/site/data/a.json#k"); b('https://x.com/none.json'); c("https://cdn.com/x.js")`,
    );
  });
});
