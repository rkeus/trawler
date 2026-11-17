import { describe, it, expect, vi } from 'vitest';
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

  it('leaves no temporary file when the temporary write fails half way', async () => {
    const dir = await makeTmpDir('json');
    const real = fs.writeFile.bind(fs);
    const spy = vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (target, data, opts) => {
      await real(target, 'partial', opts);
      throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
    });
    await expect(writeJsonFile(path.join(dir, 'a.json'), { a: 1 })).rejects.toThrow('no space left');
    spy.mockRestore();
    expect(await fs.readdir(dir)).toEqual([]);
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

  describe('writeJsonFile retries', () => {
    const busy = (code: string) => async () => {
      throw Object.assign(new Error(code), { code });
    };

    it('retries the rename when the file is briefly locked', async () => {
      const dir = await makeTmpDir('json-retry');
      const file = path.join(dir, 'a.json');
      const spy = vi.spyOn(fs, 'rename');
      try {
        spy.mockImplementationOnce(busy('EBUSY')).mockImplementationOnce(busy('EPERM'));
        await writeJsonFile(file, { ok: true }, { attempts: 5, delayMs: 1 });
        expect(spy).toHaveBeenCalledTimes(3);
        expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ ok: true });
      } finally {
        spy.mockRestore();
      }
    });

    it('gives up after the attempts and leaves no temporary file', async () => {
      const dir = await makeTmpDir('json-retry');
      const file = path.join(dir, 'a.json');
      const spy = vi.spyOn(fs, 'rename').mockImplementation(busy('EPERM'));
      try {
        await expect(writeJsonFile(file, { ok: true }, { attempts: 2, delayMs: 1 })).rejects.toThrow('EPERM');
        expect(spy).toHaveBeenCalledTimes(2);
      } finally {
        spy.mockRestore();
      }
      expect(await fs.readdir(dir)).toEqual([]);
    });

    it('does not retry other errors', async () => {
      const dir = await makeTmpDir('json-retry');
      const spy = vi.spyOn(fs, 'rename').mockImplementation(busy('ENOSPC'));
      try {
        await expect(writeJsonFile(path.join(dir, 'a.json'), 1, { attempts: 5, delayMs: 1 })).rejects.toThrow('ENOSPC');
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
