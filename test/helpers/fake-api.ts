import { vi } from 'vitest';
import type { FolderState } from '../../src/engine';
import type {
  AppState,
  HistoryEntry,
  JobEventMessage,
  JobFinishedMessage,
  RunningJob,
  StartJobRequest,
  StartJobResponse,
  TrawlerApi,
} from '../../src/shared/ipc';
import { resolveSettings } from '../../src/shared/settings';

/** A TrawlerApi for renderer tests: every command is a vi.fn with a sensible default; events are emitted by hand. */
export function fakeApi() {
  const settings = resolveSettings({}).settings;
  const snapshot = { settings, defaults: settings, warnings: [] as string[] };
  const appState: AppState = { legalNoteAccepted: true, theme: 'dark', palette: 'ember' };
  const eventListeners = new Set<(msg: JobEventMessage) => void>();
  const finishedListeners = new Set<(msg: JobFinishedMessage) => void>();

  const api = {
    getSettings: vi.fn(async () => snapshot),
    updateSettings: vi.fn(async (_patch: Record<string, unknown>) => snapshot),
    resetSettings: vi.fn(async () => snapshot),
    listHistory: vi.fn(async () => [] as HistoryEntry[]),
    removeHistory: vi.fn(async (_id: string) => [] as HistoryEntry[]),
    clearHistory: vi.fn(async () => [] as HistoryEntry[]),
    getAppState: vi.fn(async () => ({ ...appState })),
    updateAppState: vi.fn(async (patch: Partial<AppState>) => ({ ...appState, ...patch })),
    chooseFolder: vi.fn(async (_defaultPath?: string) => null as string | null),
    inspectFolder: vi.fn(async (_dir: string) => 'missing' as FolderState),
    startJob: vi.fn(
      async (_request: StartJobRequest): Promise<StartJobResponse> => ({ jobId: 'job-1', settings, warnings: [], usesAnalysisCache: false }),
    ),
    cancelJob: vi.fn(async (_jobId: string) => true),
    currentJob: vi.fn(async () => null as RunningJob | null),
    lastFinishedJob: vi.fn(async () => null as JobFinishedMessage | null),
    startPreview: vi.fn(async (outputDir: string) => ({ url: 'http://127.0.0.1:1/', outputDir })),
    stopPreview: vi.fn(async () => null),
    currentPreview: vi.fn(async () => null),
    openPreview: vi.fn(async () => null),
    openFolder: vi.fn(async (_dir: string) => null),
    openReport: vi.fn(async (_dir: string) => null),
    appInfo: vi.fn(async () => ({ version: '0.1.0', userDataDir: 'C:\\data' })),
    onJobEvent: (listener: (msg: JobEventMessage) => void) => {
      eventListeners.add(listener);
      return () => void eventListeners.delete(listener);
    },
    onJobFinished: (listener: (msg: JobFinishedMessage) => void) => {
      finishedListeners.add(listener);
      return () => void finishedListeners.delete(listener);
    },
  } satisfies TrawlerApi;

  return {
    api,
    settings,
    emitEvent: (msg: JobEventMessage) => eventListeners.forEach((l) => l(msg)),
    emitFinished: (msg: JobFinishedMessage) => finishedListeners.forEach((l) => l(msg)),
  };
}
