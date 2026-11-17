import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HistoryStore, toHistoryEntry } from '../../../src/main/history-store';
import { resolveSettings } from '../../../src/shared/settings';
import { historyEntry } from '../../helpers/history-entry';
import { makeTmpDir } from '../../helpers/tmp';

async function loaded(): Promise<{ dir: string; store: HistoryStore }> {
  const dir = await makeTmpDir('history');
  const store = new HistoryStore(HistoryStore.fileIn(dir));
  await store.load();
  return { dir, store };
}

describe('toHistoryEntry', () => {
  it('summarizes a download', () => {
    const settings = resolveSettings({ maxPages: 9 }).settings;
    const e = toHistoryEntry({
      id: 'd1',
      request: { kind: 'download', seedUrl: 'https://example.com/a/', outputDir: 'C:\\out' },
      settings,
      result: {
        kind: 'download',
        status: 'done_with_errors',
        mode: 'js',
        outputDir: 'C:\\out',
        counters: { pagesDone: 2, pagesQueued: 0, assetsDone: 5, assetsQueued: 0, bytes: 100, errors: 1 },
        verify: { pagesChecked: 2, pagesOk: 1, missing: [{ page: 'a/index.html', url: 'https://example.com/x.png', status: 404 }] },
        detection: {
          verdict: 'js',
          score: 0.8,
          frameworks: ['react'],
          uiKits: [],
          signals: { textRatio: 0, elementRatio: 0, emptyMount: true, mountIds: ['root'], frameworkMarkers: [], dataRequests: 0, moduleScripts: 1 },
          explanations: [],
        },
        warnings: [],
      },
      startedAt: 's',
      finishedAt: 'f',
    });
    expect(e).toMatchObject({
      id: 'd1',
      kind: 'download',
      seedUrl: 'https://example.com/a/',
      outputDir: 'C:\\out',
      mode: 'js',
      verdict: 'js',
      frameworks: ['react'],
      status: 'done_with_errors',
      verify: { pagesChecked: 2, pagesOk: 1, missing: 1 },
      startedAt: 's',
      finishedAt: 'f',
    });
    expect(e.settings.maxPages).toBe(9);
    expect(e.pagesFound).toBeUndefined();
  });

  it('counts the pages an analysis found and keeps the error of a failed job', () => {
    const e = historyEntry('a1', {
      kind: 'analyze',
      status: 'failed',
      mode: 'static',
      counters: { pagesDone: 0, pagesQueued: 0, assetsDone: 0, assetsQueued: 0, bytes: 0, errors: 0 },
      warnings: [],
      error: 'HTTP 404',
      analysis: {
        seedUrl: 'https://example.com/',
        mode: 'static',
        pages: ['https://example.com/', 'https://example.com/b'],
        assetCounts: { page: 0, css: 0, js: 0, image: 0, font: 0, media: 0, data: 0, other: 0 },
        externalHosts: [],
        warnings: [],
        recommended: {},
      },
    });
    expect(e.pagesFound).toBe(2);
    expect(e.error).toBe('HTTP 404');
    expect(e.outputDir).toBeUndefined();
  });
});

describe('HistoryStore', () => {
  it('keeps the newest first and at most `limit` entries', async () => {
    const { store } = await loaded();
    await store.add(historyEntry('1'), 2);
    await store.add(historyEntry('2'), 2);
    await store.add(historyEntry('3'), 2);
    expect(store.list().map((e) => e.id)).toEqual(['3', '2']);
  });

  it('stores nothing with a limit of 0', async () => {
    const { store } = await loaded();
    expect(await store.add(historyEntry('1'), 0)).toBeUndefined();
    expect(store.list()).toEqual([]);
  });

  it('returns the stored entry', async () => {
    const { store } = await loaded();
    expect((await store.add(historyEntry('1'), 5))?.id).toBe('1');
  });

  it('persists and reloads', async () => {
    const { dir, store } = await loaded();
    await store.add(historyEntry('1'), 5);
    const again = new HistoryStore(HistoryStore.fileIn(dir));
    expect(await again.load()).toEqual([]);
    expect(again.list().map((e) => e.id)).toEqual(['1']);
  });

  it('remove, clear and trim', async () => {
    const { store } = await loaded();
    for (const id of ['1', '2', '3']) await store.add(historyEntry(id), 5);
    expect((await store.remove('2')).map((e) => e.id)).toEqual(['3', '1']);
    expect((await store.trim(1)).map((e) => e.id)).toEqual(['3']);
    expect(await store.clear()).toEqual([]);
  });

  it('drops damaged entries with a warning', async () => {
    const dir = await makeTmpDir('history');
    await fs.writeFile(
      path.join(dir, 'history.json'),
      JSON.stringify({ version: 1, entries: [historyEntry('ok'), { id: 5 }, 'x'] }),
    );
    const store = new HistoryStore(HistoryStore.fileIn(dir));
    const warnings = await store.load();
    expect(store.list().map((e) => e.id)).toEqual(['ok']);
    expect(warnings).toEqual(['2 damaged history entries were dropped']);
  });

  it('moves a damaged file aside', async () => {
    const dir = await makeTmpDir('history');
    await fs.writeFile(path.join(dir, 'history.json'), '[[[');
    const store = new HistoryStore(HistoryStore.fileIn(dir));
    const warnings = await store.load();
    expect(warnings[0]).toMatch(/history\.json was damaged/);
    expect(store.list()).toEqual([]);
  });

  it('list() returns copies', async () => {
    const { store } = await loaded();
    await store.add(historyEntry('1'), 5);
    store.list()[0]!.seedUrl = 'changed';
    expect(store.list()[0]!.seedUrl).toBe('https://example.com/');
  });

  it('keeps the old list in memory when the write fails', async () => {
    const dir = await makeTmpDir('history');
    await fs.writeFile(path.join(dir, 'blocker'), 'x');
    const store = new HistoryStore(path.join(dir, 'blocker', 'history.json'));
    await expect(store.add(historyEntry('a'), 20)).rejects.toThrow();
    expect(store.list()).toEqual([]);
  });
});
