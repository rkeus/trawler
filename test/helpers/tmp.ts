import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const created: string[] = [];

/** Creates a temp folder that is removed after the test file finishes (see test/setup.ts). */
export async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `trawler-${prefix}-`));
  created.push(dir);
  return dir;
}

export async function removeTmpDirs(): Promise<void> {
  await Promise.all(created.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
}
