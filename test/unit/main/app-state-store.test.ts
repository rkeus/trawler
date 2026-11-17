import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppStateStore } from '../../../src/main/app-state-store';
import { makeTmpDir } from '../../helpers/tmp';

const DEFAULTS = { legalNoteAccepted: false, theme: 'dark', palette: 'ember' };

describe('AppStateStore', () => {
  it('starts with the legal note not accepted, dark theme and the Ember palette', async () => {
    const store = new AppStateStore(AppStateStore.fileIn(await makeTmpDir('state')));
    expect(await store.load()).toEqual(DEFAULTS);
  });

  it('updates known fields, ignores wrong types and unknown keys, and persists', async () => {
    const dir = await makeTmpDir('state');
    const store = new AppStateStore(AppStateStore.fileIn(dir));
    await store.load();
    const s = await store.update({ legalNoteAccepted: true, lastOutputDir: 'D:\\out', theme: 'light', palette: 'moss', extra: 1 });
    expect(s).toEqual({ legalNoteAccepted: true, lastOutputDir: 'D:\\out', theme: 'light', palette: 'moss' });
    expect(await store.update({ legalNoteAccepted: 'yes', lastOutputDir: '  ', theme: 'neon', palette: 'rainbow' })).toEqual(s);
    const again = new AppStateStore(AppStateStore.fileIn(dir));
    expect(await again.load()).toEqual(s);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'app-state.json'), 'utf8'))).toEqual(s);
  });

  it('fills the new fields for a state file written by an older version', async () => {
    const dir = await makeTmpDir('state');
    await fs.writeFile(path.join(dir, 'app-state.json'), JSON.stringify({ legalNoteAccepted: true }));
    expect(await new AppStateStore(AppStateStore.fileIn(dir)).load()).toEqual({ ...DEFAULTS, legalNoteAccepted: true });
  });

  it('keeps the old state in memory when the write fails', async () => {
    const dir = await makeTmpDir('app-state');
    await fs.writeFile(path.join(dir, 'blocker'), 'x');
    const store = new AppStateStore(path.join(dir, 'blocker', 'app-state.json'));
    await expect(store.update({ legalNoteAccepted: true })).rejects.toThrow();
    expect(store.get().legalNoteAccepted).toBe(false);
  });

  it('reports a damaged file as a load warning', async () => {
    const dir = await makeTmpDir('app-state');
    const file = AppStateStore.fileIn(dir);
    await fs.writeFile(file, '{not json');
    const store = new AppStateStore(file);
    await store.load();
    expect(store.loadWarnings()[0]).toContain('app-state.json was damaged');
  });
});
