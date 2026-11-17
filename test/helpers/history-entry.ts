import type { JobResult } from '../../src/engine';
import { toHistoryEntry } from '../../src/main/history-store';
import type { HistoryEntry } from '../../src/shared/ipc';
import { resolveSettings } from '../../src/shared/settings';

export const DONE_ANALYSIS: JobResult = {
  kind: 'analyze',
  status: 'done',
  mode: 'static',
  counters: { pagesDone: 1, pagesQueued: 0, assetsDone: 0, assetsQueued: 0, bytes: 10, errors: 0 },
  warnings: [],
};

/** A finished analysis of https://example.com/ as a history entry. */
export function historyEntry(id: string, result: JobResult = DONE_ANALYSIS): HistoryEntry {
  return toHistoryEntry({
    id,
    request: { kind: result.kind, seedUrl: 'https://example.com/' },
    settings: resolveSettings({}).settings,
    result,
    startedAt: '2026-11-17T10:00:00.000Z',
    finishedAt: '2026-11-17T10:00:01.000Z',
  });
}
