import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface BlobWriter {
  write(chunk: Uint8Array): Promise<void>;
  /** closes the file and returns its blob id */
  finish(): Promise<string>;
  /** discards the partial file */
  abort(): Promise<void>;
}

/** Content-addressed body storage (SHA-1 file names) used while crawling, before final placement. */
export class BlobStore {
  constructor(readonly dir: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async put(body: Buffer): Promise<string> {
    const id = createHash('sha1').update(body).digest('hex');
    try {
      await fs.writeFile(this.pathOf(id), body, { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    return id;
  }

  /** Streams a body to disk: hashed while writing, renamed to its SHA-1 when finished. */
  createWriter(): BlobWriter {
    const tmp = path.join(this.dir, `.tmp-${randomUUID()}`);
    const hash = createHash('sha1');
    let handle: fs.FileHandle | undefined;
    const open = async (): Promise<fs.FileHandle> => (handle ??= await fs.open(tmp, 'w'));
    return {
      write: async (chunk) => {
        const h = await open();
        hash.update(chunk);
        await h.write(chunk);
      },
      finish: async () => {
        await (await open()).close();
        const id = hash.digest('hex');
        try {
          await fs.rename(tmp, this.pathOf(id));
        } catch (err) {
          await fs.rm(tmp, { force: true });
          throw err;
        }
        return id;
      },
      abort: async () => {
        await handle?.close().catch(() => undefined);
        await fs.rm(tmp, { force: true });
      },
    };
  }

  get(id: string): Promise<Buffer> {
    return fs.readFile(this.pathOf(id));
  }

  pathOf(id: string): string {
    return path.join(this.dir, id);
  }

  async clear(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
