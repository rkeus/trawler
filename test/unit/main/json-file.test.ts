import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile, writeJsonFile, WriteQueue } from '../../../src/main/json-file';
import { sleep } from '../../../src/engine/sleep';
import { makeTmpDir } from '../../helpers/tmp';

describe('json-file', () => {
  it('reads a missing file as undefined', async () => {
    const dir = await makeTmpDir('json');
    expect(await readJsonFile(path.join(dir, 'nope.json'))).toEqual({ value: undefined });
  });

  it('writes and reads back, creating the folder, with no temporary files left', async () => {
    const dir = await makeTmpDir('json');
    const file = path.join(dir, 'sub', 'a.json');
    await writeJsonFile(file, { a: 1 });
    expect(await readJsonFile(file)).toEqual({ value: { a: 1 } });
    expect(await fs.readdir(path.join(dir, 'sub'))).toEqual(['a.json']);
  });

  it('moves a damaged file aside and reports where', async () => {
    const dir = await makeTmpDir('json');
    const file = path.join(dir, 'b.json');
    await fs.writeFile(file, '{ broken');
    const read = await readJsonFile(file);
    expect(read.value).toBeUndefined();
    expect(read.movedTo).toMatch(/b\.json\.corrupt-\d+$/);
    await expect(fs.readFile(read.movedTo!, 'utf8')).resolves.toBe('{ broken');
    await expect(fs.stat(file)).rejects.toThrow();
  });

  it('WriteQueue runs tasks one after another, even after a failure', async () => {
    const q = new WriteQueue();
    const order: string[] = [];
    const a = q.run(async () => {
      await sleep(30);
      order.push('a');
    });
    const b = q.run(async () => {
      order.push('b');
      throw new Error('b failed');
    });
    const c = q.run(async () => {
      order.push('c');
    });
    await a;
    await expect(b).rejects.toThrow('b failed');
    await c;
    expect(order).toEqual(['a', 'b', 'c']);
  });
});
