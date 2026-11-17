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
import { mergeSettings, withoutAppSettings } from './settings-store';

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
  /** at most one progress event per this many ms reaches the UI (default 100) */
  progressIntervalMs?: number;
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
  /** when the analysis finished (the lifetime counts from there) */
  createdAt: number;
  ttlMs: number;
  cache: FetchCache;
}

export interface AnalysisCacheInfo {
  /** normalized start URL the cache belongs to */
  seedUrl: string;
  bytes: number;
  /** time (deps.now clock) after which it is no longer reused */
  expiresAt: number;
}

interface CachePlan {
  decorate?: (fetcher: Fetcher) => Fetcher;
  /** an analysis recording into a new cache */
  recording?: AnalysisCache;
  /** a download served from the previous analysis */
  serving: boolean;
  /** the cache a serving download uses; freed when the download ends */
  consumed?: FetchCache;
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
  private closed = false;
  private expiry: NodeJS.Timeout | undefined;
  private pendingProgress: { jobId: string; event: JobEvent } | undefined;
  private progressTimer: NodeJS.Timeout | undefined;
  private lastProgressAt = 0;

  constructor(private readonly deps: JobManagerDeps) {}

  current(): RunningJob | undefined {
    return this.active ? structuredClone(this.active.info) : undefined;
  }

  start(request: StartJobRequest): StartJobResponse {
    if (this.closed) throw new Error('Trawler is shutting down.');
    if (this.active) throw new JobBusyError();
    // app-level settings (history size, analysis cache, shutdown time) always come from the saved settings
    const { settings, warnings } = mergeSettings(this.deps.settings(), withoutAppSettings(request.settings));
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

  /** The analysis that the next download of its URL would reuse, if any. */
  analysisCache(): AnalysisCacheInfo | undefined {
    const a = this.analysis;
    return a ? { seedUrl: a.seedUrl, bytes: a.cache.bytes, expiresAt: a.createdAt + a.ttlMs } : undefined;
  }

  cancel(jobId: string): boolean {
    if (!this.active || this.active.info.jobId !== jobId) return false;
    this.active.abort.abort();
    return true;
  }

  /** Refuses new jobs, cancels the running one (if any) and waits until it has cleaned up. */
  async shutdown(): Promise<void> {
    this.closed = true;
    const active = this.active;
    if (!active) return;
    active.abort.abort();
    await active.done;
  }

  private planCache(request: StartJobRequest, settings: Settings, now: number): CachePlan {
    const seedUrl = normalizeUrl(request.seedUrl);
    if (request.kind === 'analyze') {
      this.dropAnalysis(); // a new analysis replaces the previous one
      if (!seedUrl || settings.analysisCacheTtlMs === 0 || settings.analysisCacheMaxBytes === 0) return { serving: false };
      const recording: AnalysisCache = {
        seedUrl,
        userAgent: settings.userAgent,
        createdAt: now, // set again when the analysis finishes
        ttlMs: settings.analysisCacheTtlMs,
        cache: new FetchCache(settings.analysisCacheMaxBytes),
      };
      return { recording, decorate: (f) => recording.cache.record(f), serving: false };
    }
    const cached = this.analysis;
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = undefined;
    this.analysis = undefined; // reused at most once, then freed
    if (
      !cached ||
      cached.seedUrl !== seedUrl ||
      cached.userAgent !== settings.userAgent ||
      now - cached.createdAt > cached.ttlMs
    ) {
      cached?.cache.clear();
      return { serving: false };
    }
    return { decorate: (f) => cached.cache.serve(f), serving: true, consumed: cached.cache };
  }

  /** Keeps a finished analysis for the next download, and frees its memory when it expires. */
  private keepAnalysis(recording: AnalysisCache): void {
    this.dropAnalysis();
    recording.createdAt = (this.deps.now ?? Date.now)();
    this.analysis = recording;
    this.expiry = setTimeout(() => this.dropAnalysis(), recording.ttlMs);
    this.expiry.unref();
  }

  /** Frees the kept analysis now: clears its bodies and its expiry timer (whose closure would keep them alive). */
  private dropAnalysis(): void {
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = undefined;
    this.analysis?.cache.clear();
    this.analysis = undefined;
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
    this.flushProgress(); // the last counters reach the UI before the finished message
    await handle?.dispose().catch(() => undefined);
    if (plan.recording && result.status === 'done') this.keepAnalysis(plan.recording);
    else plan.recording?.cache.clear(); // a cancelled or failed analysis is not kept
    plan.consumed?.clear();

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
    if (event.type === 'progress') {
      info.counters = { ...event.counters };
      this.queueProgress(info.jobId, event);
      return;
    }
    this.flushProgress(); // progress that came before this event reaches the UI first
    if (event.type === 'phase') info.phase = event.phase;
    else if (event.type === 'detection') {
      info.detection = event.detection;
      info.mode = event.mode;
    }
    quietly(() => this.deps.onEvent({ jobId: info.jobId, event }));
  }

  private queueProgress(jobId: string, event: JobEvent): void {
    const interval = this.deps.progressIntervalMs ?? 100;
    const now = Date.now();
    if (!this.progressTimer && now - this.lastProgressAt >= interval) {
      this.lastProgressAt = now;
      quietly(() => this.deps.onEvent({ jobId, event }));
      return;
    }
    this.pendingProgress = { jobId, event }; // only the latest counters matter
    if (!this.progressTimer) {
      this.progressTimer = setTimeout(() => this.flushProgress(), Math.max(0, interval - (now - this.lastProgressAt)));
      this.progressTimer.unref();
    }
  }

  /** Sends the pending progress event, if any, and stops the timer. */
  private flushProgress(): void {
    if (this.progressTimer) clearTimeout(this.progressTimer);
    this.progressTimer = undefined;
    const pending = this.pendingProgress;
    this.pendingProgress = undefined;
    if (!pending) return;
    this.lastProgressAt = Date.now();
    quietly(() => this.deps.onEvent(pending));
  }
}
