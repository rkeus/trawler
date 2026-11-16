import path from 'node:path';
import { normalizeUrl } from '../core';
import type { Settings } from '../shared/settings';
import type { Detection } from '../shared/types';
import { buildAnalysisReport, type AnalysisReport } from './analysis';
import { BlobStore } from './blob-store';
import { crawl, resolveSeed, type CrawlResult } from './crawl';
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
import type { FetchImpl, JobEvent, JobKind, JobStatus, ProgressCounters, Verifier, VerifyReport } from './types';
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
  verifier?: Verifier;
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

function resolveMode(settings: Settings, warnings: string[]): 'static' | 'js' {
  if (settings.mode === 'js') {
    throw new JobError('JS mode needs the built-in browser, which is only available in the desktop app.');
  }
  if (settings.mode === 'auto') {
    warnings.push('Architecture detection needs the built-in browser; using static mode.');
  }
  return 'static';
}

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
 * "cancelled". The output folder is only touched after the start URL has loaded, and nothing from an earlier
 * mirror is deleted unless the new download succeeds.
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
  const phase = (p: 'crawling' | 'rewriting' | 'verifying' | 'done'): void => emit({ type: 'phase', phase: p });

  let mode: 'static' | 'js' = 'static';
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
    settings,
    status,
    errors: collectErrors(result!),
  });

  try {
    if (!normalizeUrl(req.seedUrl)) throw new JobError(`Invalid start URL: ${req.seedUrl}`);
    mode = resolveMode(settings, warnings);
    if (req.kind === 'download' && !req.outputDir) throw new JobError('Choose an output folder first.');

    const pool = new AdaptivePool({ concurrency: settings.concurrency, delayMs: settings.requestDelayMs });
    const fetcher = createFetcher({
      fetchImpl: ports.fetchImpl,
      timeoutMs: settings.requestTimeoutMs,
      retries: settings.retries,
      signal,
      ...(settings.userAgent ? { userAgent: settings.userAgent } : {}),
      onThrottle: () => {
        if (pool.reduce()) {
          emit({ type: 'log', level: 'warn', message: `Server is throttling; concurrency lowered to ${pool.concurrency}.` });
        }
      },
    });

    phase('crawling');
    // the start URL must load before the output folder is touched
    const seed = await resolveSeed(fetcher, req.seedUrl);

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
      ...(blobStore ? { blobStore } : {}),
    });
    warnings.push(...result.warnings);

    if (req.kind === 'analyze') {
      const analysis = buildAnalysisReport(result, settings, mode, undefined);
      phase('done');
      return {
        kind: 'analyze',
        status: signal.aborted ? 'cancelled' : 'done',
        mode,
        analysis,
        counters: result.counters,
        warnings,
      };
    }

    phase('rewriting');
    const fin = await finalize({ outputDir: outputDir!, crawl: result, blobStore: blobStore!, settings, progress: placed });
    await blobStore!.clear();
    const errors = collectErrors(result);
    const status: JobStatus = signal.aborted ? 'cancelled' : errors.length > 0 ? 'done_with_errors' : 'done';

    let files = fin.files;
    if (status !== 'cancelled' && policy === 'overwrite' && previous) {
      await removeStaleFiles(outputDir!, previous, fin.files.map((f) => f.path));
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
    }
    return {
      kind: req.kind,
      status: cancelled ? 'cancelled' : 'failed',
      mode,
      counters: result?.counters ?? EMPTY_COUNTERS,
      warnings,
      ...(cancelled ? {} : { error: message }),
      ...(outputDir ? { outputDir } : {}),
      ...(manifestPath ? { manifestPath } : {}),
    };
  }
}
