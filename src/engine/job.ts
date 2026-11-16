import path from 'node:path';
import { normalizeUrl } from '../core';
import type { Settings } from '../shared/settings';
import type { Detection } from '../shared/types';
import { buildAnalysisReport, type AnalysisReport } from './analysis';
import { BlobStore } from './blob-store';
import { crawl, type CrawlResult } from './crawl';
import { createFetcher } from './fetcher';
import { finalize, type FinalizeResult } from './finalize';
import { collectErrors, writeManifest, writeReport } from './manifest';
import { inspectOutputDir, prepareOutputDir, type ConcreteFolderPolicy } from './output-dir';
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
  counters?: ProgressCounters;
  verify?: VerifyReport;
  warnings: string[];
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

/** Runs an analyze or download job. Never throws: failures come back as status "failed". */
export async function runJob(req: JobRequest, ports: JobPorts, control: JobControl): Promise<JobResult> {
  const { signal, emit } = control;
  const { settings } = req;
  const warnings: string[] = [];
  const startedAt = new Date().toISOString();
  const phase = (p: 'crawling' | 'rewriting' | 'verifying' | 'done'): void => emit({ type: 'phase', phase: p });
  let mode: 'static' | 'js' = 'static';
  let blobStore: BlobStore | undefined;

  try {
    if (!normalizeUrl(req.seedUrl)) throw new JobError(`Invalid start URL: ${req.seedUrl}`);
    mode = resolveMode(settings, warnings);

    let outputDir: string | undefined;
    if (req.kind === 'download') {
      if (!req.outputDir) throw new JobError('Choose an output folder first.');
      outputDir = path.resolve(req.outputDir);
      await prepareOutputDir(outputDir, await resolveFolderPolicy(req, outputDir));
      blobStore = new BlobStore(path.join(outputDir, '_trawler', 'blobs'));
      await blobStore.init();
    }

    phase('crawling');
    const pool = new AdaptivePool({ concurrency: settings.concurrency, delayMs: settings.requestDelayMs });
    const fetcher = createFetcher({
      fetchImpl: ports.fetchImpl,
      timeoutMs: settings.requestTimeoutMs,
      retries: settings.retries,
      signal,
      ...(settings.userAgent ? { userAgent: settings.userAgent } : {}),
      onThrottle: () => {
        pool.reduce();
        emit({ type: 'log', level: 'warn', message: `Server is throttling; concurrency lowered to ${pool.concurrency}.` });
      },
    });
    const result: CrawlResult = await crawl({ seedUrl: req.seedUrl, settings, fetcher, pool, signal, emit, kind: req.kind, ...(blobStore ? { blobStore } : {}) });
    warnings.push(...result.warnings);

    if (req.kind === 'analyze') {
      const analysis = buildAnalysisReport(result, settings, mode, undefined);
      phase('done');
      return { kind: 'analyze', status: signal.aborted ? 'cancelled' : 'done', mode, analysis, counters: result.counters, warnings };
    }

    phase('rewriting');
    const fin: FinalizeResult = await finalize({ outputDir: outputDir!, crawl: result, blobStore: blobStore!, settings });
    const errors = collectErrors(result);
    const status: JobStatus = signal.aborted ? 'cancelled' : errors.length > 0 ? 'done_with_errors' : 'done';
    const manifestPath = await writeManifest(outputDir!, {
      trawlerVersion: TRAWLER_VERSION,
      seedUrl: result.seedUrl,
      basePath: fin.rootPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      mode,
      settings,
      status,
      warnings,
      files: fin.files,
      errors,
    });
    await blobStore!.clear();

    let verify: VerifyReport | undefined;
    if (status !== 'cancelled' && settings.verifyAfterDownload && ports.verifier) {
      phase('verifying');
      const preview = await startPreviewServer({ root: outputDir!, basePath: fin.rootPath });
      try {
        const pages = fin.files.filter((f) => f.kind === 'page').map((f) => f.path);
        verify = await ports.verifier.verify(preview.url, pages, signal);
      } finally {
        await preview.close();
      }
    }
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
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: 'log', level: 'error', message });
    await blobStore?.clear().catch(() => undefined); // do not leave temporary bodies behind
    return { kind: req.kind, status: 'failed', mode, counters: EMPTY_COUNTERS, warnings, error: message };
  }
}
