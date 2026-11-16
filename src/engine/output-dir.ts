import fs from 'node:fs/promises';
import path from 'node:path';
import { readManifest } from './manifest';

export type FolderState = 'missing' | 'empty' | 'non-empty';
/** `ask` is resolved by the UI before a job starts. */
export type ConcreteFolderPolicy = 'overwrite' | 'merge' | 'fail';

export class OutputDirError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutputDirError';
  }
}

/** True when `target` is strictly inside `root`. */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export async function inspectOutputDir(dir: string): Promise<FolderState> {
  try {
    const entries = await fs.readdir(dir);
    return entries.length === 0 ? 'empty' : 'non-empty';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw err;
  }
}

/**
 * Prepares the output folder.
 * - overwrite: deletes only files listed in a previous Trawler manifest there (never unknown files)
 * - merge: keeps everything, new files replace same-named ones
 * - fail: refuses a non-empty folder
 */
export async function prepareOutputDir(dir: string, policy: ConcreteFolderPolicy): Promise<void> {
  const state = await inspectOutputDir(dir);
  if (state === 'missing') {
    await fs.mkdir(dir, { recursive: true });
    return;
  }
  if (state === 'empty') return;
  if (policy === 'fail') throw new OutputDirError(`The output folder is not empty: ${dir}`);
  if (policy === 'overwrite') await removePreviousMirror(dir);
}

async function removePreviousMirror(dir: string): Promise<void> {
  const previous = await readManifest(dir);
  if (!previous) return;
  for (const file of previous.files) {
    if (typeof file.path !== 'string') continue;
    const target = path.resolve(dir, ...file.path.split('/'));
    if (!isInside(dir, target)) continue;
    await fs.rm(target, { force: true });
  }
  await fs.rm(path.join(dir, '_trawler'), { recursive: true, force: true });
}
