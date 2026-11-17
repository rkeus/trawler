import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppStateStore } from '../../../src/main/app-state-store';
import { makeTmpDir } from '../../helpers/tmp';

describe('AppStateStore', () => {
  it('starts with the legal note not accepted', async () => {
    const store = new AppStateStore(AppStateStore.fileIn(await makeTmpDir('state')));
    expect(await store.load()).toEqual({ legalNoteAccepted: false });
  });

  it('updates known fields, ignores wrong types and unknown keys, and persists', async () => {
    const dir = await makeTmpDir('state');
    const store = new AppStateStore(AppStateStore.fileIn(dir));
    await store.load();
    const s = await store.update({ legalNoteAccepted: true, lastOutputDir: 'D:\\out', extra: 1 });
    expect(s).toEqual({ legalNoteAccepted: true, lastOutputDir: 'D:\\out' });
    expect(await store.update({ legalNoteAccepted: 'yes', lastOutputDir: '  ' })).toEqual(s);
    const again = new AppStateStore(AppStateStore.fileIn(dir));
    expect(await again.load()).toEqual(s);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'app-state.json'), 'utf8'))).toEqual(s);
  });
});
