import path from 'node:path';
import type { JobResult } from '../engine';
import type { HistoryEntry, StartJobRequest } from '../shared/ipc';
import { resolveSettings, type Settings } from '../shared/settings';
import { isRecord, readJsonFile, writeJsonFile, WriteQueue } from './json-file';

export interface HistoryInput {
  id: string;
  request: Pick<StartJobRequest, 'kind' | 'seedUrl' | 'outputDir'>;
  settings: Settings;
  result: JobResult;
  startedAt: string;
  finishedAt: string;
}

export function toHistoryEntry(input: HistoryInput): HistoryEntry {
  const { id, request, settings, result, startedAt, finishedAt } = input;
  const outputDir = result.outputDir ?? request.outputDir;
  const d = result.detection;
  return {
    id,
    kind: result.kind,
    seedUrl: request.seedUrl,
    ...(outputDir ? { outputDir } : {}),
    startedAt,
    finishedAt,
    mode: result.mode,
    ...(d ? { verdict: d.verdict, frameworks: [...d.frameworks] } : {}),
    status: result.status,
    counters: { ...result.counters },
    ...(result.verify
      ? { verify: { pagesChecked: result.verify.pagesChecked, pagesOk: result.verify.pagesOk, missing: result.verify.missing.length } }
      : {}),
    ...(result.analysis ? { pagesFound: result.analysis.pages.length } : {}),
    ...(result.error ? { error: result.error } : {}),
    settings: structuredClone(settings),
  };
}

const KINDS: readonly unknown[] = ['analyze', 'download'];
const STATUSES: readonly unknown[] = ['done', 'done_with_errors', 'cancelled', 'failed'];
const MODES: readonly unknown[] = ['static', 'js'];

function readEntry(v: unknown): HistoryEntry | undefined {
  if (!isRecord(v)) return undefined;
  for (const key of ['id', 'seedUrl', 'startedAt', 'finishedAt']) if (typeof v[key] !== 'string') return undefined;
  if (!KINDS.includes(v.kind) || !STATUSES.includes(v.status) || !MODES.includes(v.mode)) return undefined;
  if (!isRecord(v.counters)) return undefined;
  return { ...(v as unknown as HistoryEntry), settings: resolveSettings(v.settings).settings };
}

/** The Recent list (userData/history.json, spec section 5): newest first, at most `historySize` entries. */
export class HistoryStore {
  private entries: HistoryEntry[] = [];
  private readonly queue = new WriteQueue();

  constructor(private readonly file: string) {}

  static fileIn(dir: string): string {
    return path.join(dir, 'history.json');
  }

  /** Returns warnings: a damaged file, dropped entries. */
  async load(): Promise<string[]> {
    const { value, movedTo } = await readJsonFile(this.file);
    const warnings = movedTo ? [`history.json was damaged and was moved to ${movedTo}`] : [];
    const raw: unknown[] = isRecord(value) && Array.isArray(value.entries) ? value.entries : [];
    this.entries = [];
    for (const item of raw) {
      const entry = readEntry(item);
      if (entry) this.entries.push(entry);
    }
    const dropped = raw.length - this.entries.length;
    if (dropped > 0) warnings.push(`${dropped} damaged history ${dropped === 1 ? 'entry was' : 'entries were'} dropped`);
    return warnings;
  }

  list(): HistoryEntry[] {
    return structuredClone(this.entries);
  }

  /** Adds an entry on top and keeps at most `limit`. Returns the stored entry, or undefined when history is off (0). */
  async add(entry: HistoryEntry, limit: number): Promise<HistoryEntry | undefined> {
    const max = Math.max(0, limit);
    await this.commit((entries) => [structuredClone(entry), ...entries.filter((e) => e.id !== entry.id)].slice(0, max));
    return max > 0 ? structuredClone(entry) : undefined;
  }

  async remove(id: string): Promise<HistoryEntry[]> {
    await this.commit((entries) => entries.filter((e) => e.id !== id));
    return this.list();
  }

  async clear(): Promise<HistoryEntry[]> {
    await this.commit(() => []);
    return [];
  }

  /** Applies a smaller historySize right away. */
  async trim(limit: number): Promise<HistoryEntry[]> {
    const max = Math.max(0, limit);
    if (this.entries.length > max) await this.commit((entries) => entries.slice(0, max));
    return this.list();
  }

  /** Writes the new list first; memory changes only when the write succeeded. */
  private commit(compute: (entries: HistoryEntry[]) => HistoryEntry[]): Promise<void> {
    return this.queue.run(async () => {
      const next = compute(this.entries);
      await writeJsonFile(this.file, { version: 1, entries: structuredClone(next) });
      this.entries = next;
    });
  }
}
