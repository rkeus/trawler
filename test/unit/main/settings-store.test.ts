import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { mergeSettings, settingsOverrides, SettingsStore, withoutAppSettings } from '../../../src/main/settings-store';
import { DEFAULT_SETTINGS, resolveSettings } from '../../../src/shared/settings';
import { makeTmpDir } from '../../helpers/tmp';

const readFile = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8')) as unknown;

describe('mergeSettings', () => {
  it('applies a patch on top of the base and merges detection key by key', () => {
    const base = resolveSettings({ maxPages: 10 }).settings;
    const { settings, warnings } = mergeSettings(base, { concurrency: 3, detection: { weights: { emptyMount: 0.5 } } });
    expect(settings.maxPages).toBe(10);
    expect(settings.concurrency).toBe(3);
    expect(settings.detection.weights).toEqual({ ...DEFAULT_SETTINGS.detection.weights, emptyMount: 0.5 });
    expect(settings.detection.thresholds).toEqual(DEFAULT_SETTINGS.detection.thresholds);
    expect(warnings).toEqual([]);
  });

  it('reports bad values and unknown keys', () => {
    const { settings, warnings } = mergeSettings(DEFAULT_SETTINGS, { maxPages: 'many', bogus: 1 });
    expect(settings.maxPages).toBe(500);
    expect(warnings).toHaveLength(2);
  });

  it('treats a missing patch as no change and a non-object patch as an error', () => {
    const base = resolveSettings({ maxPages: 7 }).settings;
    expect(mergeSettings(base, undefined).settings.maxPages).toBe(7);
    const bad = mergeSettings(base, 'x');
    expect(bad.settings.maxPages).toBe(7);
    expect(bad.warnings).toEqual(['Settings must be an object; nothing changed']);
  });
});

describe('settingsOverrides', () => {
  it('keeps only values that differ from the defaults', () => {
    const s = resolveSettings({ maxPages: 9, detection: { thresholds: { static: 0.2, js: 0.7 } } }).settings;
    expect(settingsOverrides(s)).toEqual({ maxPages: 9, detection: s.detection });
    expect(settingsOverrides(resolveSettings({}).settings)).toEqual({});
  });
});

describe('SettingsStore', () => {
  it('starts with the defaults when there is no file', async () => {
    const store = new SettingsStore(SettingsStore.fileIn(await makeTmpDir('settings')));
    const snap = await store.load();
    expect(snap.settings).toEqual(DEFAULT_SETTINGS);
    expect(snap.defaults).toEqual(DEFAULT_SETTINGS);
    expect(snap.warnings).toEqual([]);
  });

  it('saves only the overrides and reads them back', async () => {
    const dir = await makeTmpDir('settings');
    const store = new SettingsStore(SettingsStore.fileIn(dir));
    await store.load();
    const snap = await store.update({ maxPages: 42 });
    expect(snap.settings.maxPages).toBe(42);
    expect(await readFile(path.join(dir, 'settings.json'))).toEqual({ maxPages: 42 });
    const again = new SettingsStore(SettingsStore.fileIn(dir));
    expect((await again.load()).settings.maxPages).toBe(42);
  });

  it('returns the warnings of an update', async () => {
    const store = new SettingsStore(SettingsStore.fileIn(await makeTmpDir('settings')));
    await store.load();
    const snap = await store.update({ concurrency: 1000 });
    expect(snap.settings.concurrency).toBe(32);
    expect(snap.warnings).toHaveLength(1);
  });

  it('reset() goes back to the defaults and empties the file', async () => {
    const dir = await makeTmpDir('settings');
    const store = new SettingsStore(SettingsStore.fileIn(dir));
    await store.load();
    await store.update({ maxPages: 3 });
    const snap = await store.reset();
    expect(snap.settings).toEqual(DEFAULT_SETTINGS);
    expect(await readFile(path.join(dir, 'settings.json'))).toEqual({});
  });

  it('get() returns a copy', async () => {
    const store = new SettingsStore(SettingsStore.fileIn(await makeTmpDir('settings')));
    await store.load();
    store.get().maxPages = 1;
    expect(store.get().maxPages).toBe(500);
  });

  it('moves a damaged file aside and warns', async () => {
    const dir = await makeTmpDir('settings');
    await fs.writeFile(path.join(dir, 'settings.json'), 'nope{');
    const snap = await new SettingsStore(SettingsStore.fileIn(dir)).load();
    expect(snap.settings).toEqual(DEFAULT_SETTINGS);
    expect(snap.warnings[0]).toMatch(/settings\.json was damaged/);
  });

  it('warns about bad stored values', async () => {
    const dir = await makeTmpDir('settings');
    await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ maxPages: 'lots' }));
    const snap = await new SettingsStore(SettingsStore.fileIn(dir)).load();
    expect(snap.settings.maxPages).toBe(500);
    expect(snap.warnings).toHaveLength(1);
  });
});

describe('withoutAppSettings', () => {
  it('drops app-level keys from a per-job patch and leaves other values alone', () => {
    expect(withoutAppSettings({ historySize: 1, analysisCacheTtlMs: 0, maxPages: 3 })).toEqual({ maxPages: 3 });
    expect(withoutAppSettings(undefined)).toBeUndefined();
    expect(withoutAppSettings('x')).toBe('x');
  });

  it('keeps the old settings in memory when the write fails', async () => {
    const dir = await makeTmpDir('settings');
    await fs.writeFile(path.join(dir, 'blocker'), 'x');
    const store = new SettingsStore(path.join(dir, 'blocker', 'settings.json'));
    const before = store.get();
    await expect(store.update({ maxDepth: 9 })).rejects.toThrow();
    expect(store.get()).toEqual(before);
    await expect(store.reset()).rejects.toThrow();
    expect(store.get()).toEqual(before);
  });
});
