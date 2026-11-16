import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

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
