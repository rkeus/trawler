import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startFixtureServer, type FixtureServer } from '../helpers/fixture-server';
import { cdnSite, staticSite } from '../fixtures/static-site';
import { createStaticVerifier, runJob, startPreviewServer } from '../../src/engine';
import { resolveSettings } from '../../src/shared/settings';
import { makeTmpDir } from '../helpers/tmp';

let cdn: FixtureServer;
let site: FixtureServer;
beforeAll(async () => {
  cdn = await startFixtureServer(() => cdnSite());
  site = await startFixtureServer(() => staticSite(cdn.url));
});
afterAll(async () => {
  await site.close();
  await cdn.close();
});

const control = () => ({ signal: new AbortController().signal, emit: () => undefined });

describe('static mirror end to end', () => {
  it('downloads the fixture template into a working local copy', async () => {
    const out = await makeTmpDir('e2e');
    const settings = resolveSettings({ retries: 0 }).settings;
    const result = await runJob(
      { kind: 'download', seedUrl: `${site.url}/html/index.html`, outputDir: out, settings },
      { fetchImpl: fetch, verifier: createStaticVerifier(fetch) },
      control(),
    );

    expect(result.status).toBe('done_with_errors'); // missing.png is a real 404 on the server
    expect(result.basePath).toBe('/'); // /assets/shared/ sits above /html/
    const cdnDir = `vendor/${new URL(cdn.url).host.replace(':', '_')}`;
    for (const p of [
      'html/index.html',
      'html/about.html',
      'html/blog/index.html',
      'html/contact.html',
      'html/assets/css/style.css',
      'html/assets/css/theme.css',
      'html/assets/fonts/icons.woff2',
      'html/assets/img/logo.png',
      'html/assets/img/logo@2x.png',
      'html/assets/img/bg.png',
      'html/assets/img/lazy.png',
      'html/assets/js/app.js',
      'assets/shared/common.css',
      'assets/shared/pattern.png',
      `${cdnDir}/lib/cdn.css`,
      `${cdnDir}/lib/cdn.png`,
    ]) {
      await expect(fs.stat(path.join(out, ...p.split('/')))).resolves.toBeDefined();
    }

    const index = await fs.readFile(path.join(out, 'html', 'index.html'), 'utf8');
    expect(index).toContain('href="assets/css/style.css"');
    expect(index).toContain('href="../assets/shared/common.css"');
    expect(index).toContain(`href="../${cdnDir}/lib/cdn.css"`);
    expect(index).toContain('href="about.html">Old');
    expect(index).toContain('href="contact.html"');
    expect(index).toContain('href="blog/index.html"');
    expect(index).toContain(`href="${site.url}/html/private/secret.html"`);
    expect(index).toContain(`src="${site.url}/html/assets/img/missing.png"`);
    expect(index).toContain('data-bg="assets/img/lazy.png"');
    expect(site.requests).not.toContain('/html/private/secret.html');

    const css = await fs.readFile(path.join(out, 'html', 'assets', 'css', 'style.css'), 'utf8');
    expect(css).toContain('url("../fonts/icons.woff2")');

    expect(result.verify?.missing).toEqual([]);
    expect(result.verify?.pagesOk).toBe(4);

    const preview = await startPreviewServer({ root: out, basePath: result.basePath! });
    try {
      const page = await fetch(`${preview.url}html/about.html`);
      expect(page.status).toBe(200);
    } finally {
      await preview.close();
    }
  });

  it('analyzes the template without downloading images', async () => {
    const before = site.requests.length;
    const result = await runJob(
      { kind: 'analyze', seedUrl: `${site.url}/html/index.html`, settings: resolveSettings({ retries: 0 }).settings },
      { fetchImpl: fetch },
      control(),
    );
    expect(result.status).toBe('done');
    expect(result.analysis?.pages).toHaveLength(4);
    expect(result.analysis?.assetCounts).toMatchObject({ css: 4, font: 1, js: 1, image: 7 });
    expect(result.analysis?.externalHosts).toEqual([{ host: new URL(cdn.url).host, count: 2 }]);
    expect(site.requests.slice(before)).not.toContain('/html/assets/img/logo.png');
  });
});
