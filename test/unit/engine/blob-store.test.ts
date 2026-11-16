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
});
