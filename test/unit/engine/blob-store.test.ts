import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BlobStore } from '../../../src/engine/blob-store';
import { makeTmpDir } from '../../helpers/tmp';

describe('BlobStore', () => {
  it('stores content-addressed bodies, dedupes, and clears', async () => {
    const dir = path.join(await makeTmpDir('blob'), 'blobs');
    const store = new BlobStore(dir);
    await store.init();
    const a = await store.put(Buffer.from('abc'));
    const b = await store.put(Buffer.from('abc'));
    expect(a).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(b).toBe(a);
    expect((await store.get(a)).toString()).toBe('abc');
    expect(store.pathOf(a)).toBe(path.join(dir, a));
    await store.clear();
    await expect(fs.stat(dir)).rejects.toBeDefined();
  });
  it('streams a body to a content-addressed file', async () => {
    const dir = path.join(await makeTmpDir('blob2'), 'blobs');
    const store = new BlobStore(dir);
    await store.init();
    const w = store.createWriter();
    await w.write(Buffer.from('ab'));
    await w.write(Buffer.from('c'));
    const id = await w.finish();
    expect(id).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect((await store.get(id)).toString()).toBe('abc');
    const aborted = store.createWriter();
    await aborted.write(Buffer.from('zzz'));
    await aborted.abort();
    expect((await fs.readdir(dir)).sort()).toEqual([id]);
  });
});
