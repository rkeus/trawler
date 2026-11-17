import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PreviewManager } from '../../../src/main/preview-manager';
import { makeTmpDir } from '../../helpers/tmp';

async function mirror(basePath: string, title: string): Promise<string> {
  const dir = await makeTmpDir('preview');
  await fs.mkdir(path.join(dir, '_trawler'), { recursive: true });
  await fs.writeFile(path.join(dir, '_trawler', 'manifest.json'), JSON.stringify({ basePath, files: [] }));
  await fs.writeFile(path.join(dir, 'index.html'), `<!doctype html><title>${title}</title>`);
  return dir;
}

describe('PreviewManager', () => {
  it('serves a download under its base path', async () => {
    const pm = new PreviewManager();
    const dir = await mirror('/html/', 'one');
    const info = await pm.start(dir);
    try {
      expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/html\/$/);
      expect(info.outputDir).toBe(path.resolve(dir));
      expect(pm.current()).toEqual(info);
      const res = await fetch(`${info.url}index.html`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('one');
    } finally {
      await pm.stop();
    }
  });

  it('runs one preview at a time and stops the previous one', async () => {
    const pm = new PreviewManager();
    const first = await pm.start(await mirror('/', 'one'));
    const second = await pm.start(await mirror('/', 'two'));
    try {
      await expect(fetch(`${first.url}index.html`)).rejects.toThrow();
      expect(await (await fetch(`${second.url}index.html`)).text()).toContain('two');
    } finally {
      await pm.stop();
    }
    expect(pm.current()).toBeUndefined();
    await expect(fetch(`${second.url}index.html`)).rejects.toThrow();
  });

  it('refuses a folder without a Trawler download', async () => {
    const pm = new PreviewManager();
    await expect(pm.start(await makeTmpDir('preview'))).rejects.toThrow(/no Trawler download/);
    expect(pm.current()).toBeUndefined();
  });

  it('stop() without a preview does nothing', async () => {
    await expect(new PreviewManager().stop()).resolves.toBeUndefined();
  });
});
