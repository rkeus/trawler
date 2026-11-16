import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startPreviewServer, type PreviewServer } from '../../../src/engine/preview-server';
import { createStaticVerifier } from '../../../src/engine/static-verifier';

let preview: PreviewServer;
beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trawler-ver-'));
  await fs.mkdir(path.join(dir, 'css'));
  await fs.writeFile(path.join(dir, 'index.html'), '<link rel="stylesheet" href="css/a.css"><img src="ok.png"><img src="https://cdn.example/x.png">');
  await fs.writeFile(path.join(dir, 'bad.html'), '<img src="missing.png">');
  await fs.writeFile(path.join(dir, 'css', 'a.css'), '.a{background:url(../gone.png)}');
  await fs.writeFile(path.join(dir, 'ok.png'), 'PNG');
  preview = await startPreviewServer({ root: dir, basePath: '/' });
});
afterAll(() => preview.close());

describe('createStaticVerifier', () => {
  it('reports missing local refs, including refs inside CSS, and ignores external URLs', async () => {
    const v = createStaticVerifier(fetch);
    const r = await v.verify(preview.url, ['index.html', 'bad.html'], new AbortController().signal);
    expect(r.pagesChecked).toBe(2);
    expect(r.pagesOk).toBe(0);
    expect(r.missing.map((m) => [m.page, new URL(m.url).pathname, m.status])).toEqual([
      ['index.html', '/gone.png', 404],
      ['bad.html', '/missing.png', 404],
    ]);
  });
});
