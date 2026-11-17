import { describe, it, expect } from 'vitest';
import { initialModel, MAX_FINISHED_ERRORS, MAX_LOG_LINES, type Model } from '../../../src/renderer/state/model';
import { reducer } from '../../../src/renderer/state/reducer';
import type { AppState, HistoryEntry, JobFinishedMessage, RunningJob, SettingsSnapshot } from '../../../src/shared/ipc';
import { resolveSettings } from '../../../src/shared/settings';
import { historyEntry } from '../../helpers/history-entry';

const settings = resolveSettings({}).settings;
const snapshot: SettingsSnapshot = { settings, defaults: settings, warnings: [] };
const appState: AppState = { legalNoteAccepted: true, theme: 'dark', palette: 'ember' };
const ZERO = { pagesDone: 0, pagesQueued: 0, assetsDone: 0, assetsQueued: 0, bytes: 0, errors: 0 };

function loaded(over: { history?: HistoryEntry[]; current?: RunningJob | null; last?: JobFinishedMessage | null } = {}): Model {
  return reducer(initialModel(), {
    type: 'loaded',
    settings: snapshot,
    history: over.history ?? [],
    appState,
    info: { version: '0.1.0', userDataDir: 'C:\\data', startupWarnings: [] },
    current: over.current ?? null,
    last: over.last ?? null,
    at: 1,
  });
}

function started(m: Model, kind: 'analyze' | 'download' = 'analyze'): Model {
  return reducer(m, {
    type: 'job-started',
    request: { kind, seedUrl: 'https://example.com/' },
    response: { jobId: 'j1', settings, warnings: [], usesAnalysisCache: false },
    startedAt: '2026-11-17T10:00:00.000Z',
    at: 2,
  });
}

describe('reducer', () => {
  it('starts on the start screen once loaded', () => {
    const m = loaded();
    expect(m.ready).toBe(true);
    expect(m.screen).toBe('start');
    expect(m.job).toBeNull();
  });

  it('reconnects to a running job and to a finished one', () => {
    const running: RunningJob = { jobId: 'j9', kind: 'download', seedUrl: 'https://a.test/', startedAt: 's', phase: 'crawling', counters: { ...ZERO, pagesDone: 3 } };
    const m = loaded({ current: running });
    expect(m.screen).toBe('progress');
    expect(m.job?.jobId).toBe('j9');
    expect(m.job?.phase).toBe('crawling');
    expect(m.job?.counters.pagesDone).toBe(3);
    const last: JobFinishedMessage = { jobId: 'j8', result: { kind: 'analyze', status: 'done', mode: 'static', counters: ZERO, warnings: [] } };
    const f = loaded({ last });
    expect(f.screen).toBe('progress');
    expect(f.finished?.jobId).toBe('j8');
  });

  it('follows a job: phase, detection, progress, logs', () => {
    let m = started(loaded());
    expect(m.screen).toBe('progress');
    expect(m.job?.jobId).toBe('j1');
    const ev = (event: any) => reducer(m, { type: 'job-event', msg: { jobId: 'j1', event }, at: 3 });
    m = ev({ type: 'phase', phase: 'crawling' });
    m = ev({ type: 'progress', counters: { ...ZERO, pagesDone: 2, pagesQueued: 4 } });
    m = ev({ type: 'log', level: 'warn', message: 'throttled', url: 'https://example.com/x' });
    m = ev({ type: 'detection', mode: 'js', detection: { verdict: 'hybrid', score: 0.3, frameworks: [], uiKits: [], signals: {}, explanations: [] } });
    expect(m.job?.phase).toBe('crawling');
    expect(m.job?.counters).toMatchObject({ pagesDone: 2, pagesQueued: 4 });
    expect(m.job?.mode).toBe('js');
    expect(m.job?.log.map((l) => l.level)).toEqual(['info', 'info', 'warn', 'info']);
    expect(m.job?.log[2]).toMatchObject({ text: 'throttled', url: 'https://example.com/x' });
    expect(m.job?.log[3]?.text).toBe('Detected hybrid (score 0.30); using js mode');
  });

  it('ignores events of another job', () => {
    const m = started(loaded());
    expect(reducer(m, { type: 'job-event', msg: { jobId: 'other', event: { type: 'phase', phase: 'done' } }, at: 3 })).toBe(m);
  });

  it('keeps at most MAX_LOG_LINES log lines, dropping the oldest', () => {
    let m = started(loaded());
    for (let i = 0; i < MAX_LOG_LINES + 20; i++) {
      m = reducer(m, { type: 'job-event', msg: { jobId: 'j1', event: { type: 'log', level: 'info', message: `line ${i}` } }, at: 3 });
    }
    expect(m.job?.log).toHaveLength(MAX_LOG_LINES);
    expect(m.job?.log.at(-1)?.text).toBe(`line ${MAX_LOG_LINES + 19}`);
    expect(m.job?.log[0]?.text).not.toBe('Job started');
  });

  it('finishes a job: shows the result and puts the history entry first', () => {
    const old = historyEntry('old');
    let m = started(loaded({ history: [old] }));
    const entry = historyEntry('j1');
    m = reducer(m, { type: 'job-finished', msg: { jobId: 'j1', result: { kind: 'analyze', status: 'done', mode: 'static', counters: ZERO, warnings: [] }, history: entry } });
    expect(m.job).toBeNull();
    expect(m.finished?.jobId).toBe('j1');
    expect(m.screen).toBe('progress');
    expect(m.history.map((h) => h.id)).toEqual(['j1', 'old']);
  });

  it('ignores a finish message of another job while one runs', () => {
    const m = started(loaded());
    const other = reducer(m, { type: 'job-finished', msg: { jobId: 'zzz', result: { kind: 'analyze', status: 'done', mode: 'static', counters: ZERO, warnings: [] } } });
    expect(other).toBe(m);
  });

  it('dismissing the result returns to the start screen', () => {
    let m = started(loaded());
    m = reducer(m, { type: 'job-finished', msg: { jobId: 'j1', result: { kind: 'analyze', status: 'done', mode: 'static', counters: ZERO, warnings: [] } } });
    m = reducer(m, { type: 'dismiss-finished' });
    expect(m.finished).toBeNull();
    expect(m.screen).toBe('start');
  });

  it('does not navigate to progress when there is nothing to show', () => {
    const m = loaded();
    expect(reducer(m, { type: 'navigate', screen: 'progress' }).screen).toBe('start');
    expect(reducer(started(m), { type: 'navigate', screen: 'start' }).screen).toBe('start');
  });

  it('keeps a load failure', () => {
    expect(reducer(initialModel(), { type: 'load-failed', message: 'boom' }).loadError).toBe('boom');
  });
  it('keeps the startup warnings until they are dismissed', () => {
    const m = reducer(initialModel(), {
      type: 'loaded',
      settings: snapshot,
      history: [],
      appState,
      info: { version: '0.1.0', userDataDir: 'C:\data', startupWarnings: ['history.json was damaged'] },
      current: null,
      last: null,
      at: 1,
    });
    expect(m.startupWarnings).toEqual(['history.json was damaged']);
    expect(reducer(m, { type: 'dismiss-startup-warnings' }).startupWarnings).toEqual([]);
  });

  it('opens the settings screen at any time and stays there when a job ends', () => {
    let m = reducer(started(loaded()), { type: 'navigate', screen: 'settings' });
    expect(m.screen).toBe('settings');
    m = reducer(m, { type: 'job-finished', msg: { jobId: 'j1', result: { kind: 'analyze', status: 'done', mode: 'static', counters: ZERO, warnings: [] } } });
    expect(m.screen).toBe('settings');
    expect(m.finished?.jobId).toBe('j1');
    expect(reducer(m, { type: 'navigate', screen: 'progress' }).screen).toBe('progress');
  });

  it('remembers the error lines of the job that ended, and drops them with the result', () => {
    let m = started(loaded(), 'download');
    m = reducer(m, { type: 'job-event', msg: { jobId: 'j1', event: { type: 'log', level: 'error', message: 'HTTP 404', url: 'https://example.com/x.png' } }, at: 2 });
    m = reducer(m, { type: 'job-event', msg: { jobId: 'j1', event: { type: 'log', level: 'info', message: 'fine' } }, at: 3 });
    m = reducer(m, { type: 'job-finished', msg: { jobId: 'j1', result: { kind: 'download', status: 'done_with_errors', mode: 'static', counters: ZERO, warnings: [] } } });
    expect(m.finishedErrors.map((l) => l.text)).toEqual(['HTTP 404']);
    m = reducer(m, { type: 'dismiss-finished' });
    expect(m.finishedErrors).toEqual([]);
  });

  it('keeps at most MAX_FINISHED_ERRORS error lines', () => {
    let m = started(loaded(), 'download');
    for (let i = 0; i < MAX_FINISHED_ERRORS + 5; i++) {
      m = reducer(m, { type: 'job-event', msg: { jobId: 'j1', event: { type: 'log', level: 'error', message: `e${i}` } }, at: i });
    }
    m = reducer(m, { type: 'job-finished', msg: { jobId: 'j1', result: { kind: 'download', status: 'done_with_errors', mode: 'static', counters: ZERO, warnings: [] } } });
    expect(m.finishedErrors).toHaveLength(MAX_FINISHED_ERRORS);
    expect(m.finishedErrors.at(-1)?.text).toBe(`e${MAX_FINISHED_ERRORS + 4}`);
  });
});
