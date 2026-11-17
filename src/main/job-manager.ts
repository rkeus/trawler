import { randomUUID } from 'node:crypto';
import { normalizeUrl } from '../core';
import {
  FetchCache,
  runJob,
  type Fetcher,
  type JobEvent,
  type JobPorts,
  type JobRequest,
  type JobResult,
  type ProgressCounters,
} from '../engine';
import type {
  HistoryEntry,
  JobEventMessage,
  JobFinishedMessage,
  RunningJob,
  StartJobRequest,
  StartJobResponse,
} from '../shared/ipc';
import type { Settings } from '../shared/settings';
import { toHistoryEntry } from './history-store';
import { mergeSettings } from './settings-store';

export interface PortsHandle {
  ports: JobPorts;
  /** releases what the ports hold; called once after the job */
  dispose(): Promise<void>;
}

export interface JobManagerDeps {
  /** the saved settings (a fresh copy on every call) */
  settings: () => Settings;
  createPorts: (settings: Settings) => PortsHandle | Promise<PortsHandle>;
  /** stores a finished job; returns the stored entry, or undefined when history is off */
  record: (entry: HistoryEntry, settings: Settings) => Promise<HistoryEntry | undefined>;
  onEvent: (msg: JobEventMessage) => void;
  onFinished: (msg: JobFinishedMessage) => void;
  /** test seams */
  run?: typeof runJob;
  now?: () => number;
  newId?: () => string;
}

export class JobBusyError extends Error {
  constructor() {
    super('A job is already running. Cancel it or wait until it finishes.');
    this.name = 'JobBusyError';
  }
}

interface AnalysisCache {
  seedUrl: string;
  userAgent: string;
  createdAt: number;
  cache: FetchCache;
}

interface CachePlan {
  decorate?: (fetcher: Fetcher) => Fetcher;
  /** an analysis recording into a new cache */
  recording?: AnalysisCache;
  /** a download served from the previous analysis */
  serving: boolean;
}

interface ActiveJob {
  info: RunningJob;
  abort: AbortController;
  done: Promise<void>;
}

const ZERO: ProgressCounters = { pagesDone: 0, pagesQueued: 0, assetsDone: 0, assetsQueued: 0, bytes: 0, errors: 0 };

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function quietly(fn: () => void): void {
  try {
    fn();
  } catch {
    // a closed window must not break the job
  }
}

/**
 * Runs the desktop app's jobs, one at a time. Keeps the pages and stylesheets an analysis fetched, so the download of
 * the same URL that follows does not fetch them again (spec section 4.7). Forwards job events and records every
 * finished job in the history.
 */
export class JobManager {
  private active: ActiveJob | undefined;
  private analysis: AnalysisCache | undefined;

  constructor(private readonly deps: JobManagerDeps) {}

  current(): RunningJob | undefined {
    return this.active ? structuredClone(this.active.info) : undefined;
  }

  start(request: StartJobRequest): StartJobResponse {
    if (this.active) throw new JobBusyError();
    const { settings, warnings } = mergeSettings(this.deps.settings(), request.settings);
    const now = (this.deps.now ?? Date.now)();
    const jobId = (this.deps.newId ?? randomUUID)();
    const info: RunningJob = {
      jobId,
      kind: request.kind,
      seedUrl: request.seedUrl,
      startedAt: new Date(now).toISOString(),
      ...(request.outputDir ? { outputDir: request.outputDir } : {}),
    };
    const plan = this.planCache(request, settings, now);
    const active: ActiveJob = { info, abort: new AbortController(), done: Promise.resolve() };
    this.active = active;
    active.done = this.execute(active, request, settings, plan);
    return { jobId, settings, warnings, usesAnalysisCache: plan.serving };
  }

  cancel(jobId: string): boolean {
    if (!this.active || this.active.info.jobId !== jobId) return false;
    this.active.abort.abort();
    return true;
  }

  /** Cancels the running job, if any, and waits until it has cleaned up. */
  async shutdown(): Promise<void> {
    const active = this.active;
    if (!active) return;
    active.abort.abort();
    await active.done;
  }

  private planCache(request: StartJobRequest, settings: Settings, now: number): CachePlan {
    const seedUrl = normalizeUrl(request.seedUrl);
    if (request.kind === 'analyze') {
      this.analysis = undefined; // a new analysis replaces the previous one
      if (!seedUrl || settings.analysisCacheTtlMs === 0 || settings.analysisCacheMaxBytes === 0) return { serving: false };
      const recording: AnalysisCache = {
        seedUrl,
        userAgent: settings.userAgent,
        createdAt: now,
        cache: new FetchCache(settings.analysisCacheMaxBytes),
      };
      return { recording, decorate: (f) => recording.cache.record(f), serving: false };
    }
    const cached = this.analysis;
    this.analysis = undefined; // reused at most once, then freed
    if (
      !cached ||
      cached.seedUrl !== seedUrl ||
      cached.userAgent !== settings.userAgent ||
      now - cached.createdAt > settings.analysisCacheTtlMs
    ) {
      return { serving: false };
    }
    return { decorate: (f) => cached.cache.serve(f), serving: true };
  }

  private async execute(active: ActiveJob, request: StartJobRequest, settings: Settings, plan: CachePlan): Promise<void> {
    const { info, abort } = active;
    let handle: PortsHandle | undefined;
    let result: JobResult;
    try {
      handle = await this.deps.createPorts(settings);
      const base = handle.ports;
      const decorate = plan.decorate;
      const ports: JobPorts = decorate
        ? {
            ...base,
            decorateFetcher: (fetcher, signal) => decorate(base.decorateFetcher ? base.decorateFetcher(fetcher, signal) : fetcher),
          }
        : base;
      const jobRequest: JobRequest = {
        kind: request.kind,
        seedUrl: request.seedUrl,
        settings,
        ...(request.outputDir ? { outputDir: request.outputDir } : {}),
        ...(request.folderPolicy ? { folderPolicy: request.folderPolicy } : {}),
      };
      result = await (this.deps.run ?? runJob)(jobRequest, ports, {
        signal: abort.signal,
        emit: (event) => this.forward(info, event),
      });
    } catch (err) {
      // runJob never throws: this is createPorts failing
      const cancelled = abort.signal.aborted;
      result = {
        kind: request.kind,
        status: cancelled ? 'cancelled' : 'failed',
        mode: 'static',
        counters: { ...ZERO },
        warnings: [],
        ...(cancelled ? {} : { error: message(err) }),
      };
    }
    await handle?.dispose().catch(() => undefined);
    if (plan.recording && result.status === 'done') this.analysis = plan.recording;

    const finishedAt = new Date((this.deps.now ?? Date.now)()).toISOString();
    let history: HistoryEntry | undefined;
    try {
      history = await this.deps.record(
        toHistoryEntry({ id: info.jobId, request, settings, result, startedAt: info.startedAt, finishedAt }),
        settings,
      );
    } catch {
      // the history is best effort
    }
    this.active = undefined;
    quietly(() => this.deps.onFinished({ jobId: info.jobId, result, ...(history ? { history } : {}) }));
  }

  private forward(info: RunningJob, event: JobEvent): void {
    if (event.type === 'phase') info.phase = event.phase;
    else if (event.type === 'progress') info.counters = { ...event.counters };
    else if (event.type === 'detection') {
      info.detection = event.detection;
      info.mode = event.mode;
    }
    quietly(() => this.deps.onEvent({ jobId: info.jobId, event }));
  }
}
