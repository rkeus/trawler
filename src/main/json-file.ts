import fs from 'node:fs/promises';
import path from 'node:path';

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface JsonRead {
  /** parsed content; undefined when the file is missing or damaged */
  value: unknown;
  /** set when the file was damaged and was moved to this path */
  movedTo?: string;
}

/**
 * Reads a JSON file. A damaged file is renamed to "<name>.corrupt-<time>", so the app starts with defaults and the
 * user's data is not lost.
 */
export async function readJsonFile(file: string): Promise<JsonRead> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { value: undefined };
    throw err;
  }
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    const movedTo = `${file}.corrupt-${Date.now()}`;
    try {
      await fs.rename(file, movedTo);
      return { value: undefined, movedTo };
    } catch {
      return { value: undefined };
    }
  }
}

const RETRY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES']);

export interface WriteOptions {
  /** how many times the final rename is tried when the target is briefly locked (antivirus, indexer) */
  attempts?: number;
  /** wait before the next try is delayMs times the number of tries so far */
  delayMs?: number;
}

async function renameWithRetry(from: string, to: string, { attempts = 5, delayMs = 40 }: WriteOptions): Promise<void> {
  for (let tried = 1; ; tried++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (tried >= attempts || !code || !RETRY_CODES.has(code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * tried));
    }
  }
}

/** Writes JSON through a temporary file and a rename, so a crash never leaves a half-written file. */
export async function writeJsonFile(file: string, value: unknown, options: WriteOptions = {}): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}
`, 'utf8');
  try {
    await renameWithRetry(tmp, file, options);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** Runs async tasks one after another, so writes to one file never interleave. A failed task does not stop the queue. */
export class WriteQueue {
  private tail: Promise<void> = Promise.resolve();

  run(task: () => Promise<void>): Promise<void> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
