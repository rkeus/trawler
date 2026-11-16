import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  inspectOutputDir,
  prepareOutputDir,
  isInside,
  OutputDirError,
  removeStaleFiles,
  mergeFileLists,
} from '../../../src/engine/output-dir';
import { collectErrors, writeManifest, readManifest, type Manifest } from '../../../src/engine/manifest';
import type { CrawlResult } from '../../../src/engine/crawl';
import { computeScope } from '../../../src/core';
import { resolveSettings } from '../../../src/shared/settings';
import { makeTmpDir } from '../../helpers/tmp';

const tmp = () => makeTmpDir('out');

function manifest(files: string[]): Manifest {
  return {
    trawlerVersion: '0.1.0', seedUrl: 'https://x.com/', basePath: '/', startedAt: 'a', finishedAt: 'b',
    mode: 'static', settings: resolveSettings({}).settings, status: 'done', warnings: [],
    files: files.map((p) => ({ url: `https://x.com/${p}`, aliases: [], path: p, status: 200, bytes: 1, kind: 'other' })),
    errors: [],
  };
}

describe('output dir', () => {
  it('inspects missing, empty and non-empty folders', async () => {
    const dir = await tmp();
    expect(await inspectOutputDir(path.join(dir, 'nope'))).toBe('missing');
    expect(await inspectOutputDir(dir)).toBe('empty');
    await fs.writeFile(path.join(dir, 'x.txt'), 'x');
    expect(await inspectOutputDir(dir)).toBe('non-empty');
  });

  it('creates a missing folder and refuses a non-empty one with fail', async () => {
    const dir = await tmp();
    await prepareOutputDir(path.join(dir, 'new', 'deep'), 'fail');
    expect(await inspectOutputDir(path.join(dir, 'new', 'deep'))).toBe('empty');
    await fs.writeFile(path.join(dir, 'x.txt'), 'x');
    await expect(prepareOutputDir(dir, 'fail')).rejects.toBeInstanceOf(OutputDirError);
  });

  it('prepare never deletes anything and returns the previous manifest', async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 'old.html'), 'old');
    await writeManifest(dir, manifest(['old.html']));
    const previous = await prepareOutputDir(dir, 'overwrite');
    expect(previous?.files.map((f) => f.path)).toEqual(['old.html']);
    expect(await fs.readFile(path.join(dir, 'old.html'), 'utf8')).toBe('old');
  });

  it('removeStaleFiles deletes only unreused files of the previous mirror', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, 'a'), { recursive: true });
    await fs.writeFile(path.join(dir, 'a', 'old.html'), 'old');
    await fs.writeFile(path.join(dir, 'a', 'Kept.html'), 'new');
    await fs.writeFile(path.join(dir, 'mine.txt'), 'keep me');
    const removed = await removeStaleFiles(dir, manifest(['a/old.html', 'a/kept.html', '../outside.txt']), ['a/Kept.html']);
    expect(removed).toEqual(['a/old.html']);
    await expect(fs.stat(path.join(dir, 'a', 'old.html'))).rejects.toBeDefined();
    expect(await fs.readFile(path.join(dir, 'a', 'Kept.html'), 'utf8')).toBe('new');
    expect(await fs.readFile(path.join(dir, 'mine.txt'), 'utf8')).toBe('keep me');
  });

  it('mergeFileLists keeps previous files tracked unless replaced', () => {
    const merged = mergeFileLists(manifest(['a.html', 'b.html']), manifest(['B.html', 'c.html']).files);
    expect(merged.map((f) => f.path)).toEqual(['B.html', 'c.html', 'a.html']);
    expect(mergeFileLists(undefined, manifest(['x']).files).map((f) => f.path)).toEqual(['x']);
  });


  it('merge keeps everything', async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 'mine.txt'), 'keep');
    await prepareOutputDir(dir, 'merge');
    expect(await fs.readFile(path.join(dir, 'mine.txt'), 'utf8')).toBe('keep');
  });

  it('isInside guards paths', () => {
    expect(isInside('/out', '/out/a/b')).toBe(true);
    expect(isInside('/out', '/out')).toBe(false);
    expect(isInside('/out', '/outside/x')).toBe(false);
    expect(isInside('/out', '/out/../etc')).toBe(false);
  });
});

describe('manifest', () => {
  it('writes and reads back', async () => {
    const dir = await tmp();
    await writeManifest(dir, manifest(['index.html']));
    expect((await readManifest(dir))?.files[0]?.path).toBe('index.html');
  });

  it('collects errors from crawl records, skipping cancelled requests', () => {
    const crawl = {
      records: new Map([
        ['u1', { url: 'u1', finalUrl: 'u1', kind: 'image', isPage: false, depth: 0, fetched: false, status: 404, bytes: 0, referrers: ['p'], error: 'HTTP 404', errorReason: 'http' }],
        ['u2', { url: 'u2', finalUrl: 'u2', kind: 'image', isPage: false, depth: 0, fetched: false, status: 0, bytes: 0, referrers: [], error: 'Cancelled', errorReason: 'aborted' }],
      ]),
      scope: computeScope('https://x.com/'),
    } as unknown as CrawlResult;
    expect(collectErrors(crawl)).toEqual([{ url: 'u1', referrers: ['p'], reason: 'HTTP 404', status: 404 }]);
  });
});
