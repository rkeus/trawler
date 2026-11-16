import path from 'node:path';
import { normalizeUrl } from '../core';
import type { Settings } from '../shared/settings';
import type { Detection } from '../shared/types';
import { buildAnalysisReport, type AnalysisReport } from './analysis';
import { BlobStore } from './blob-store';
import { crawl, resolveSeed, type CrawlResult } from './crawl';
import { detectArchitecture } from './detect-architecture';
import { createFetcher } from './fetcher';
import { finalize, type FinalizeProgress } from './finalize';
import { collectErrors, writeManifest, writeReport, type Manifest } from './manifest';
import {
  inspectOutputDir,
  mergeFileLists,
  prepareOutputDir,
  removeStaleFiles,
  type ConcreteFolderPolicy,
} from './output-dir';
import { AdaptivePool } from './pool';
import { startPreviewServer } from './preview-server';
import type {
  CaptureResult,
  Capturer,
  FetchImpl,
  Fetcher,
  JobEvent,
  JobKind,
  JobPhase,
  JobStatus,
  ProgressCounters,
  Verifier,
  VerifyReport,
} from './types';
import { TRAWLER_VERSION } from './version';

export interface JobRequest {
  kind: JobKind;
  seedUrl: string;
  /** required for downloads */
  outputDir?: string;
  settings: Settings;
  /** resolves settings.nonEmptyFolder === 'ask' (the UI asks the user) */
  folderPolicy?: ConcreteFolderPolicy;
}

export interface JobPorts {
  fetchImpl: FetchImpl;
  /** hidden-browser renderer (desktop app); enables detection and JS mode */
  capturer?: Capturer;
  verifier?: Verifier;
  /** wraps the job's fetcher, e.g. with withChallengeSolver (desktop app) */
  decorateFetcher?: (fetcher: Fetcher, signal: AbortSignal) => Fetcher;
}

export interface JobControl {
  signal: AbortSignal;
  emit: (event: JobEvent) => void;
}

export interface JobResult {
  kind: JobKind;
  status: JobStatus;
  mode: 'static' | 'js';
  detection?: Detection;
  analysis?: AnalysisReport;
  outputDir?: string;
  /** preview base path of the copy */
  basePath?: string;
  manifestPath?: string;
  counters: ProgressCounters;
  verify?: VerifyReport;
  warnings: string[];
  /** set when status is "failed" */
  error?: string;
}

class JobError extends Error {}

const EMPTY_COUNTERS: ProgressCounters = { pagesDone: 0, pagesQueued: 0, assetsDone: 0, assetsQueued: 0, bytes: 0, errors: 0 };

async function resolveFolderPolicy(req: JobRequest, outputDir: string): Promise<ConcreteFolderPolicy> {
  if (req.folderPolicy) return req.folderPolicy;
  if (req.settings.nonEmptyFolder !== 'ask') return req.settings.nonEmptyFolder;
  if ((await inspectOutputDir(outputDir)) === 'non-empty') {
    throw new JobError('The output folder is not empty. Choose overwrite, merge or cancel.');
  }
  return 'merge';
}

/**
 * Runs an analyze or download job. Never throws: failures come back as status "failed", cancellation as
 * "cancelled". With a capturer, the start page is rendered first to detect the architecture (spec §4.2).
 * The output folder is only touched after the start URL has loaded, and nothing from an earlier mirror is
 * deleted unless the new download succeeds.
 */
export async function runJob(req: JobRequest, ports: JobPorts, control: JobControl): Promise<JobResult> {
  const { signal } = control;
  const emit = (event: JobEvent): void => {
    try {
      control.emit(event);
    } catch {
      // a broken listener (e.g. a closed window) must not break the job
    }
  };
  const { settings } = req;
  const warnings: string[] = [];
  const startedAt = new Date().toISOString();
  const phase = (p: JobPhase): void => emit({ type: 'phase', phase: p });

  // aborted on cancel, or when the crawl halts on a fatal error: stops requests already in flight
  const fetchAbort = new AbortController();
  const onUserAbort = (): void => fetchAbort.abort();
  if (signal.aborted) fetchAbort.abort();
  else signal.addEventListener('abort', onUserAbort, { once: true });

  let mode: 'static' | 'js' = 'static';
  let detection: Detection | undefined;
  let outputDir: string | undefined;
  let blobStore: BlobStore | undefined;
  let previous: Manifest | undefined;
  let result: CrawlResult | undefined;
  const placed: FinalizeProgress = { files: [] };

  const manifestBase = (status: JobStatus) => ({
    trawlerVersion: TRAWLER_VERSION,
    seedUrl: result!.seedUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    mode,
    ...(detection ? { detection } : {}),
    settings,
    status,
    errors: collectErrors(result!),
  });

  try {
    if (!normalizeUrl(req.seedUrl)) throw new JobError(`Invalid start URL: ${req.seedUrl}`);
    if (settings.mode === 'js' && !ports.capturer) {
      throw new JobError('JS mode needs the built-in browser, which is only available in the desktop app.');
    }
    if (settings.mode === 'auto' && !ports.capturer) {
      warnings.push('Architecture detection needs the built-in browser; using static mode.');
    }
    mode = settings.mode === 'js' ? 'js' : 'static';
    if (req.kind === 'download' && !req.outputDir) throw new JobError('Choose an output folder first.');
    const wantDetection = Boolean(ports.capturer) && (settings.mode === 'auto' || req.kind === 'analyze');

    const pool = new AdaptivePool({ concurrency: settings.concurrency, delayMs: settings.requestDelayMs });
    const baseFetcher = createFetcher({
      fetchImpl: ports.fetchImpl,
      timeoutMs: settings.requestTimeoutMs,
      idleTimeoutMs: settings.idleTimeoutMs,
      retries: settings.retries,
      signal: fetchAbort.signal,
      memoryLimitBytes: settings.memoryBodyLimitBytes,
      spillTo: () => blobStore,
      ...(settings.userAgent ? { userAgent: settings.userAgent } : {}),
      onThrottle: () => {
        if (pool.reduce()) {
          emit({ type: 'log', level: 'warn', message: `Server is throttling; concurrency lowered to ${pool.concurrency}.` });
        }
      },
    });
    const fetcher = ports.decorateFetcher ? ports.decorateFetcher(baseFetcher, fetchAbort.signal) : baseFetcher;

    phase(wantDetection ? 'detecting' : 'crawling');
    // the start URL must load before the output folder is touched
    const seed = await resolveSeed(fetcher, req.seedUrl);

    let seedCapture: CaptureResult | undefined;
    if (wantDetection) {
      try {
        const found = await detectArchitecture(seed, ports.capturer!, settings, fetchAbort.signal);
        detection = found.detection;
        seedCapture = found.capture;
        if (settings.mode === 'auto') mode = detection.verdict === 'static' ? 'static' : 'js';
        emit({ type: 'detection', detection, mode });
      } catch (err) {
        if (signal.aborted) throw err;
        warnings.push(
          `Architecture detection failed (${err instanceof Error ? err.message : String(err)}); using ${mode === 'js' ? 'JS' : 'static'} mode.`,
        );
      }
      phase('crawling');
    }

    let policy: ConcreteFolderPolicy | undefined;
    if (req.kind === 'download') {
      outputDir = path.resolve(req.outputDir!);
      policy = await resolveFolderPolicy(req, outputDir);
      previous = await prepareOutputDir(outputDir, policy);
      blobStore = new BlobStore(path.join(outputDir, '_trawler', 'blobs'));
      await blobStore.clear(); // never reuse bodies from an interrupted earlier run
      await blobStore.init();
    }

    result = await crawl({
      seedUrl: req.seedUrl,
      seed,
      settings,
      fetcher,
      pool,
      signal,
      emit,
      kind: req.kind,
      mode,
      ...(ports.capturer ? { capturer: ports.capturer } : {}),
      ...(mode === 'js' && seedCapture ? { seedCapture } : {}),
      onHalt: () => fetchAbort.abort(),
      ...(blobStore ? { blobStore } : {}),
    });
    warnings.push(...result.warnings);

    if (req.kind === 'analyze') {
      const analysis = buildAnalysisReport(result, settings, mode, detection);
      phase('done');
      return {
        kind: 'analyze',
        status: signal.aborted ? 'cancelled' : 'done',
        mode,
        ...(detection ? { detection } : {}),
        analysis,
        counters: result.counters,
        warnings,
      };
    }

    phase('rewriting');
    const fin = await finalize({
      outputDir: outputDir!,
      crawl: result,
      blobStore: blobStore!,
      settings,
      progress: placed,
      ...(policy === 'overwrite' && previous
        ? { previousPaths: new Set(previous.files.map((f) => f.path.toLowerCase())) }
        : {}),
    });
    await blobStore!.clear();
    const errors = collectErrors(result);
    const status: JobStatus = signal.aborted ? 'cancelled' : errors.length > 0 ? 'done_with_errors' : 'done';

    let files = fin.files;
    if (status !== 'cancelled' && policy === 'overwrite' && previous) {
      const { failed } = await removeStaleFiles(outputDir!, previous, fin.files.map((f) => f.path));
      if (failed.length > 0) {
        const shown = failed.slice(0, 5).join(', ');
        warnings.push(
          `Could not remove ${failed.length} file(s) of the previous mirror: ${shown}${failed.length > 5 ? ', ...' : ''}`,
        );
        // what is still on disk stays tracked
        files = mergeFileLists({ ...previous, files: previous.files.filter((f) => failed.includes(f.path)) }, fin.files);
      }
    } else {
      files = mergeFileLists(previous, fin.files);
    }

    let verify: VerifyReport | undefined;
    if (status !== 'cancelled' && settings.verifyAfterDownload && ports.verifier) {
      phase('verifying');
      try {
        const preview = await startPreviewServer({ root: outputDir!, basePath: fin.rootPath });
        try {
          const pages = fin.files.filter((f) => f.kind === 'page').map((f) => f.path);
          verify = await ports.verifier.verify(preview.url, pages, signal);
        } finally {
          await preview.close();
        }
      } catch (err) {
        warnings.push(`Verification could not run: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (signal.aborted && verify) {
        verify = undefined;
        warnings.push('Verification was cancelled.');
      }
    }

    const manifestPath = await writeManifest(outputDir!, { ...manifestBase(status), basePath: fin.rootPath, warnings, files });
    await writeReport(outputDir!, { status, warnings, ...(verify ? { verify } : {}) });
    phase('done');
    return {
      kind: 'download',
      status,
      mode,
      ...(detection ? { detection } : {}),
      outputDir: outputDir!,
      basePath: fin.rootPath,
      manifestPath,
      counters: result.counters,
      ...(verify ? { verify } : {}),
      warnings,
    };
  } catch (err) {
    const cancelled = signal.aborted;
    const message = err instanceof Error ? err.message : String(err);
    if (!cancelled) emit({ type: 'log', level: 'error', message });
    await blobStore?.clear().catch(() => undefined); // do not leave temporary bodies behind

    // keep track of files that were already placed (spec §7: partial manifest)
    let manifestPath: string | undefined;
    if (outputDir && result) {
      const status: JobStatus = cancelled ? 'cancelled' : 'failed';
      manifestPath = await writeManifest(outputDir, {
        ...manifestBase(status),
        basePath: placed.rootPath ?? result.scope.basePath,
        warnings: [...warnings, message],
        files: mergeFileLists(previous, placed.files),
      }).catch(() => undefined);
      await writeReport(outputDir, { status, warnings: [...warnings, message] }).catch(() => undefined);
    }
    return {
      kind: req.kind,
      status: cancelled ? 'cancelled' : 'failed',
      mode,
      ...(detection ? { detection } : {}),
      counters: result?.counters ?? EMPTY_COUNTERS,
      warnings,
      ...(cancelled ? {} : { error: message }),
      ...(outputDir ? { outputDir } : {}),
      ...(manifestPath ? { manifestPath } : {}),
    };
  } finally {
    signal.removeEventListener('abort', onUserAbort);
  }
}
