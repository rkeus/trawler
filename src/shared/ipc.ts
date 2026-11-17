// Typed contract between the main process, the preload and the UI. Imports from the engine are type-only, so the
// renderer bundle never pulls in engine code.
import type {
  ConcreteFolderPolicy,
  FolderState,
  JobEvent,
  JobKind,
  JobPhase,
  JobResult,
  JobStatus,
  ProgressCounters,
} from '../engine';
import type { Settings } from './settings';
import type { Detection, Verdict } from './types';

export interface SettingsSnapshot {
  settings: Settings;
  defaults: Settings;
  /** problems in the stored file or in the last change (each such value fell back to its default or was clamped) */
  warnings: string[];
}

export interface HistoryEntry {
  id: string;
  kind: JobKind;
  seedUrl: string;
  outputDir?: string;
  startedAt: string;
  finishedAt: string;
  mode: 'static' | 'js';
  verdict?: Verdict;
  frameworks?: string[];
  status: JobStatus;
  counters: ProgressCounters;
  /** verification summary of a download */
  verify?: { pagesChecked: number; pagesOk: number; missing: number };
  /** pages an analysis found */
  pagesFound?: number;
  error?: string;
  /** the settings the job ran with; Repeat starts a job with them */
  settings: Settings;
}

export interface AppState {
  /** the legal note (spec section 1) was shown and accepted */
  legalNoteAccepted: boolean;
  /** the last chosen output folder, offered next time */
  lastOutputDir?: string;
}

export interface StartJobRequest {
  kind: JobKind;
  seedUrl: string;
  /** absolute path; required for downloads */
  outputDir?: string;
  /** answers nonEmptyFolder = "ask" after the UI asked the user */
  folderPolicy?: ConcreteFolderPolicy;
  /** per-job changes on top of the saved settings (recommended settings, or a history entry's settings) */
  settings?: Record<string, unknown>;
}

export interface StartJobResponse {
  jobId: string;
  /** the settings the job runs with */
  settings: Settings;
  /** problems in the per-job settings */
  warnings: string[];
  /** the download reuses the pages and stylesheets of the analysis that came just before it */
  usesAnalysisCache: boolean;
}

/** The running job, as far as its events have told; lets a reloaded UI catch up. */
export interface RunningJob {
  jobId: string;
  kind: JobKind;
  seedUrl: string;
  outputDir?: string;
  startedAt: string;
  phase?: JobPhase;
  mode?: 'static' | 'js';
  detection?: Detection;
  counters?: ProgressCounters;
}

export interface JobEventMessage {
  jobId: string;
  event: JobEvent;
}

export interface JobFinishedMessage {
  jobId: string;
  result: JobResult;
  /** the stored history entry (absent when history is off or could not be saved) */
  history?: HistoryEntry;
}

export interface PreviewInfo {
  /** preview URL of the copy, e.g. http://127.0.0.1:5123/html/ */
  url: string;
  outputDir: string;
}

export interface AppInfo {
  version: string;
  userDataDir: string;
}

/** Commands the UI can invoke: arguments and result of each. */
export interface InvokeContract {
  getSettings: { args: []; result: SettingsSnapshot };
  updateSettings: { args: [patch: Record<string, unknown>]; result: SettingsSnapshot };
  resetSettings: { args: []; result: SettingsSnapshot };
  listHistory: { args: []; result: HistoryEntry[] };
  removeHistory: { args: [id: string]; result: HistoryEntry[] };
  clearHistory: { args: []; result: HistoryEntry[] };
  getAppState: { args: []; result: AppState };
  updateAppState: { args: [patch: Partial<AppState>]; result: AppState };
  chooseFolder: { args: [defaultPath?: string]; result: string | null };
  inspectFolder: { args: [dir: string]; result: FolderState };
  startJob: { args: [request: StartJobRequest]; result: StartJobResponse };
  cancelJob: { args: [jobId: string]; result: boolean };
  currentJob: { args: []; result: RunningJob | null };
  startPreview: { args: [outputDir: string]; result: PreviewInfo };
  stopPreview: { args: []; result: null };
  currentPreview: { args: []; result: PreviewInfo | null };
  /** opens the running preview in the default browser */
  openPreview: { args: []; result: null };
  openFolder: { args: [dir: string]; result: null };
  /** opens <outputDir>/_trawler/report.json with the OS */
  openReport: { args: [outputDir: string]; result: null };
  appInfo: { args: []; result: AppInfo };
}

export type InvokeName = keyof InvokeContract;

/** IPC channel of each command. */
export const IPC = {
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  resetSettings: 'settings:reset',
  listHistory: 'history:list',
  removeHistory: 'history:remove',
  clearHistory: 'history:clear',
  getAppState: 'app-state:get',
  updateAppState: 'app-state:update',
  chooseFolder: 'dialog:choose-folder',
  inspectFolder: 'folder:inspect',
  startJob: 'job:start',
  cancelJob: 'job:cancel',
  currentJob: 'job:current',
  startPreview: 'preview:start',
  stopPreview: 'preview:stop',
  currentPreview: 'preview:current',
  openPreview: 'preview:open',
  openFolder: 'shell:open-folder',
  openReport: 'shell:open-report',
  appInfo: 'app:info',
} as const satisfies Record<InvokeName, string>;

/** Channels the main process sends on. */
export const IPC_EVENTS = {
  jobEvent: 'job:event',
  jobFinished: 'job:finished',
} as const;

export type IpcErrorCode = 'busy' | 'invalid' | 'untrusted' | 'unknown-command' | 'failed';

/** Every command reply is wrapped, so errors reach the UI as plain messages with a machine-readable code. */
export type IpcReply<T> = { ok: true; value: T } | { ok: false; error: string; code: IpcErrorCode };

export interface JobSubscriptions {
  /** returns an unsubscribe function */
  onJobEvent(listener: (msg: JobEventMessage) => void): () => void;
  onJobFinished(listener: (msg: JobFinishedMessage) => void): () => void;
}

/**
 * `window.trawler` as the preload exposes it: every command resolves with its reply. Replies are values because
 * custom Error properties (such as a code) do not survive Electron's context bridge.
 */
export type TrawlerBridge = {
  [K in InvokeName]: (...args: InvokeContract[K]['args']) => Promise<IpcReply<InvokeContract[K]['result']>>;
} & JobSubscriptions;

/** What the UI code uses: commands resolve with the value and reject with an error that carries a `code` (renderer/api.ts). */
export type TrawlerApi = {
  [K in InvokeName]: (...args: InvokeContract[K]['args']) => Promise<InvokeContract[K]['result']>;
} & JobSubscriptions;
