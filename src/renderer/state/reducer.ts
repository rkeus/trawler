import type { JobKind } from '../../engine';
import type {
  AppInfo,
  AppState,
  HistoryEntry,
  JobEventMessage,
  JobFinishedMessage,
  RunningJob,
  SettingsSnapshot,
  StartJobResponse,
} from '../../shared/ipc';
import { MAX_LOG_LINES, ZERO_COUNTERS, type JobView, type LogLine, type Model, type Screen } from './model';

export type Action =
  | {
      type: 'loaded';
      settings: SettingsSnapshot;
      history: HistoryEntry[];
      appState: AppState;
      info: AppInfo;
      current: RunningJob | null;
      last: JobFinishedMessage | null;
      at: number;
    }
  | { type: 'load-failed'; message: string }
  | { type: 'settings'; snapshot: SettingsSnapshot }
  | { type: 'history'; entries: HistoryEntry[] }
  | { type: 'app-state'; state: AppState }
  | { type: 'job-started'; request: { kind: JobKind; seedUrl: string; outputDir?: string }; response: StartJobResponse; startedAt: string; at: number }
  | { type: 'job-event'; msg: JobEventMessage; at: number }
  | { type: 'job-finished'; msg: JobFinishedMessage }
  | { type: 'navigate'; screen: Screen }
  | { type: 'dismiss-finished' };

function addLog(job: JobView, at: number, level: LogLine['level'], text: string, url?: string): JobView {
  const line: LogLine = { id: job.nextLogId, at, level, text, ...(url ? { url } : {}) };
  const log = job.log.length >= MAX_LOG_LINES ? [...job.log.slice(job.log.length - MAX_LOG_LINES + 1), line] : [...job.log, line];
  return { ...job, log, nextLogId: job.nextLogId + 1 };
}

function viewFromRunning(r: RunningJob): JobView {
  return {
    jobId: r.jobId,
    kind: r.kind,
    seedUrl: r.seedUrl,
    ...(r.outputDir ? { outputDir: r.outputDir } : {}),
    startedAt: r.startedAt,
    ...(r.phase ? { phase: r.phase } : {}),
    ...(r.mode ? { mode: r.mode } : {}),
    ...(r.detection ? { detection: r.detection } : {}),
    counters: r.counters ?? { ...ZERO_COUNTERS },
    usesAnalysisCache: false,
    log: [],
    nextLogId: 0,
  };
}

export function reducer(m: Model, a: Action): Model {
  switch (a.type) {
    case 'loaded': {
      const base: Model = { ...m, ready: true, settings: a.settings, history: a.history, appState: a.appState, info: a.info };
      if (a.current) {
        const job = addLog(viewFromRunning(a.current), a.at, 'info', 'Reconnected to the running job.');
        return { ...base, job, finished: null, screen: 'progress' };
      }
      if (a.last) return { ...base, job: null, finished: a.last, screen: 'progress' };
      return { ...base, job: null, finished: null, screen: 'start' };
    }
    case 'load-failed':
      return { ...m, loadError: a.message };
    case 'settings':
      return { ...m, settings: a.snapshot };
    case 'history':
      return { ...m, history: a.entries };
    case 'app-state':
      return { ...m, appState: a.state };
    case 'job-started': {
      const view: JobView = {
        jobId: a.response.jobId,
        kind: a.request.kind,
        seedUrl: a.request.seedUrl,
        ...(a.request.outputDir ? { outputDir: a.request.outputDir } : {}),
        startedAt: a.startedAt,
        counters: { ...ZERO_COUNTERS },
        usesAnalysisCache: a.response.usesAnalysisCache,
        log: [],
        nextLogId: 0,
      };
      const text = a.response.usesAnalysisCache ? 'Job started (reusing the pages of the last analysis)' : 'Job started';
      return { ...m, job: addLog(view, a.at, 'info', text), finished: null, screen: 'progress' };
    }
    case 'job-event': {
      const job = m.job;
      // events always follow the reply that starts a job, so an event for an unknown job is stale
      if (!job || job.jobId !== a.msg.jobId) return m;
      const e = a.msg.event;
      switch (e.type) {
        case 'phase':
          return { ...m, job: addLog({ ...job, phase: e.phase }, a.at, 'info', `Phase: ${e.phase}`) };
        case 'detection':
          return {
            ...m,
            job: addLog(
              { ...job, detection: e.detection, mode: e.mode },
              a.at,
              'info',
              `Detected ${e.detection.verdict} (score ${e.detection.score.toFixed(2)}); using ${e.mode} mode`,
            ),
          };
        case 'progress':
          return { ...m, job: { ...job, counters: e.counters } };
        case 'log':
          return { ...m, job: addLog(job, a.at, e.level, e.message, e.url) };
      }
      return m;
    }
    case 'job-finished': {
      if (m.job && m.job.jobId !== a.msg.jobId) return m;
      const entry = a.msg.history;
      const history = entry ? [entry, ...m.history.filter((h) => h.id !== entry.id)] : m.history;
      return { ...m, job: null, finished: a.msg, history, screen: 'progress' };
    }
    case 'navigate':
      if (a.screen === 'progress' && !m.job && !m.finished) return m;
      return { ...m, screen: a.screen };
    case 'dismiss-finished':
      return { ...m, finished: null, screen: 'start' };
  }
}
