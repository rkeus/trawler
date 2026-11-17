import type { JobKind, JobPhase, ProgressCounters } from '../../engine';
import type { AppInfo, AppState, HistoryEntry, JobFinishedMessage, SettingsSnapshot } from '../../shared/ipc';
import type { Detection } from '../../shared/types';

export type Screen = 'start' | 'progress';

export interface LogLine {
  id: number;
  at: number;
  level: 'info' | 'warn' | 'error';
  text: string;
  url?: string;
}

export interface JobView {
  jobId: string;
  kind: JobKind;
  seedUrl: string;
  outputDir?: string;
  startedAt: string;
  phase?: JobPhase;
  mode?: 'static' | 'js';
  detection?: Detection;
  counters: ProgressCounters;
  usesAnalysisCache: boolean;
  log: LogLine[];
  nextLogId: number;
}

export interface Model {
  ready: boolean;
  loadError?: string;
  settings: SettingsSnapshot | null;
  history: HistoryEntry[];
  appState: AppState | null;
  info: AppInfo | null;
  /** the running job */
  job: JobView | null;
  /** the job that ended last; shown until the user dismisses it */
  finished: JobFinishedMessage | null;
  screen: Screen;
}

export const MAX_LOG_LINES = 500;

export const ZERO_COUNTERS: ProgressCounters = { pagesDone: 0, pagesQueued: 0, assetsDone: 0, assetsQueued: 0, bytes: 0, errors: 0 };

export function initialModel(): Model {
  return { ready: false, settings: null, history: [], appState: null, info: null, job: null, finished: null, screen: 'start' };
}
