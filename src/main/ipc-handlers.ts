import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectOutputDir } from '../engine';
import type { AppInfo, InvokeContract, InvokeName, IpcReply, StartJobRequest } from '../shared/ipc';
import type { AppStateStore } from './app-state-store';
import type { HistoryStore } from './history-store';
import type { JobManager } from './job-manager';
import { isRecord } from './json-file';
import type { PreviewManager } from './preview-manager';
import type { SettingsStore } from './settings-store';

export interface AppServices {
  settings: Pick<SettingsStore, 'snapshot' | 'update' | 'reset'>;
  history: Pick<HistoryStore, 'list' | 'remove' | 'clear' | 'trim'>;
  appState: Pick<AppStateStore, 'get' | 'update'>;
  jobs: Pick<JobManager, 'start' | 'cancel' | 'current'>;
  preview: Pick<PreviewManager, 'start' | 'stop' | 'current'>;
  info: AppInfo;
  /** native folder picker; null when cancelled */
  chooseFolder(defaultPath?: string): Promise<string | null>;
  /** opens a folder or file with the OS; rejects with the OS error */
  openPath(target: string): Promise<void>;
  /** opens a URL in the default browser */
  openExternal(url: string): Promise<void>;
}

export type Handlers = { [K in InvokeName]: (...args: unknown[]) => Promise<InvokeContract[K]['result']> };

const POLICIES: readonly unknown[] = ['overwrite', 'merge', 'fail'];

function text(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${name}: expected a non-empty string`);
  return v;
}

function absolutePath(v: unknown, name: string): string {
  const s = text(v, name);
  // UNC and device paths would make the OS contact other machines (and send credentials) on a stat
  if (/^[\\/]{2}/.test(s)) throw new Error(`${name}: network and device paths are not supported`);
  if (!path.isAbsolute(s)) throw new Error(`${name}: expected an absolute path`);
  return path.resolve(s);
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

function startRequest(v: unknown): StartJobRequest {
  if (!isRecord(v)) throw new Error('startJob: expected a job request');
  if (v.kind !== 'analyze' && v.kind !== 'download') throw new Error('kind: expected "analyze" or "download"');
  const req: StartJobRequest = { kind: v.kind, seedUrl: text(v.seedUrl, 'seedUrl') };
  if (v.outputDir !== undefined) req.outputDir = absolutePath(v.outputDir, 'outputDir');
  if (v.folderPolicy !== undefined) {
    if (!POLICIES.includes(v.folderPolicy)) throw new Error('folderPolicy: expected "overwrite", "merge" or "fail"');
    req.folderPolicy = v.folderPolicy as StartJobRequest['folderPolicy'];
  }
  if (v.settings !== undefined) {
    if (!isRecord(v.settings)) throw new Error('settings: expected an object');
    req.settings = v.settings; // every value is validated by resolveSettings
  }
  return req;
}

/** The main-process side of every command (spec section 3). The renderer is not trusted: all input is checked. */
export function createHandlers(s: AppServices): Handlers {
  return {
    getSettings: async () => s.settings.snapshot(),
    updateSettings: async (patch) => {
      const snap = await s.settings.update(patch);
      await s.history.trim(snap.settings.historySize);
      return snap;
    },
    resetSettings: async () => {
      const snap = await s.settings.reset();
      await s.history.trim(snap.settings.historySize);
      return snap;
    },
    listHistory: async () => s.history.list(),
    removeHistory: async (id) => s.history.remove(text(id, 'id')),
    clearHistory: async () => s.history.clear(),
    getAppState: async () => s.appState.get(),
    updateAppState: async (patch) => s.appState.update(patch),
    chooseFolder: async (defaultPath) =>
      s.chooseFolder(defaultPath === undefined || defaultPath === null ? undefined : absolutePath(defaultPath, 'defaultPath')),
    inspectFolder: async (dir) => inspectOutputDir(absolutePath(dir, 'dir')),
    startJob: async (request) => {
      const req = startRequest(request);
      const started = s.jobs.start(req);
      if (req.outputDir) await s.appState.update({ lastOutputDir: req.outputDir }).catch(() => undefined);
      return started;
    },
    cancelJob: async (jobId) => s.jobs.cancel(text(jobId, 'jobId')),
    currentJob: async () => s.jobs.current() ?? null,
    startPreview: async (dir) => s.preview.start(absolutePath(dir, 'outputDir')),
    stopPreview: async () => {
      await s.preview.stop();
      return null;
    },
    currentPreview: async () => s.preview.current() ?? null,
    openPreview: async () => {
      const running = s.preview.current();
      if (!running) throw new Error('No preview is running.');
      await s.openExternal(running.url);
      return null;
    },
    openFolder: async (dir) => {
      const target = absolutePath(dir, 'dir');
      if (!(await isDirectory(target))) throw new Error(`Folder not found: ${target}`);
      await s.openPath(target);
      return null;
    },
    openReport: async (dir) => {
      const report = path.join(absolutePath(dir, 'outputDir'), '_trawler', 'report.json');
      if (!(await isFile(report))) throw new Error('This folder has no Trawler report.');
      await s.openPath(report);
      return null;
    },
    appInfo: async () => ({ ...s.info }),
  };
}

/** Runs one command and wraps the outcome for the renderer. */
export async function invokeHandler(handlers: Handlers, name: string, args: unknown[]): Promise<IpcReply<unknown>> {
  if (!Object.hasOwn(handlers, name)) return { ok: false, error: `Unknown command: ${name}` };
  try {
    const handler = handlers[name as InvokeName] as (...a: unknown[]) => Promise<unknown>;
    return { ok: true, value: await handler(...args) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
