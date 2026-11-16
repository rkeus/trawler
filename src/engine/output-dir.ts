import fs from 'node:fs/promises';
import path from 'node:path';
import { readManifest, type Manifest } from './manifest';
import type { PlacedFile } from './types';

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
 * Prepares the output folder and returns the previous Trawler manifest found there, if any.
 * Nothing is deleted here — a failed or cancelled job must never cost the user an earlier mirror.
 * - fail: refuses a non-empty folder
 * - overwrite: after a successful download, call removeStaleFiles()
 * - merge: keeps everything (new files replace same-named ones)
 */
export async function prepareOutputDir(dir: string, policy: ConcreteFolderPolicy): Promise<Manifest | undefined> {
  const state = await inspectOutputDir(dir);
  if (state === 'missing') {
    await fs.mkdir(dir, { recursive: true });
    return undefined;
  }
  if (state === 'empty') return undefined;
  if (policy === 'fail') throw new OutputDirError(`The output folder is not empty: ${dir}`);
  return readManifest(dir);
}

/**
 * overwrite policy, after a successful download: deletes files of the previous Trawler mirror that the
 * new mirror did not reuse. Never touches unknown files or anything outside `dir`. Returns removed paths.
 */
export async function removeStaleFiles(dir: string, previous: Manifest, keep: Iterable<string>): Promise<string[]> {
  const kept = new Set([...keep].map((p) => p.toLowerCase()));
  const removed: string[] = [];
  for (const file of previous.files) {
    if (typeof file.path !== 'string' || kept.has(file.path.toLowerCase())) continue;
    const target = path.resolve(dir, ...file.path.split('/'));
    if (!isInside(dir, target)) continue;
    await fs.rm(target, { force: true });
    removed.push(file.path);
  }
  return removed;
}

/** Files of a previous mirror that stay in the folder (merge, or a cancelled/failed run) remain tracked. */
export function mergeFileLists(previous: Manifest | undefined, current: PlacedFile[]): PlacedFile[] {
  if (!previous) return current;
  const seen = new Set(current.map((f) => f.path.toLowerCase()));
  return [...current, ...previous.files.filter((f) => typeof f.path === 'string' && !seen.has(f.path.toLowerCase()))];
}
