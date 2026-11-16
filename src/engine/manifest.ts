import fs from 'node:fs/promises';
import path from 'node:path';
import type { Settings } from '../shared/settings';
import type { Detection } from '../shared/types';
import type { CrawlResult } from './crawl';
import type { JobStatus, PlacedFile, VerifyReport } from './types';

export interface ManifestError {
  url: string;
  referrers: string[];
  reason: string;
  status?: number;
}

export interface Manifest {
  trawlerVersion: string;
  seedUrl: string;
  /** server path served at the output root (preview base path) */
  basePath: string;
  startedAt: string;
  finishedAt: string;
  mode: 'static' | 'js';
  detection?: Detection;
  settings: Settings;
  status: JobStatus;
  warnings: string[];
  files: PlacedFile[];
  errors: ManifestError[];
}

export interface Report {
  status: JobStatus;
  warnings: string[];
  verify?: VerifyReport;
}

const dirOf = (outputDir: string): string => path.join(outputDir, '_trawler');

export function collectErrors(crawl: CrawlResult): ManifestError[] {
  const out: ManifestError[] = [];
  for (const r of crawl.records.values()) {
    if (!r.error || r.errorReason === 'aborted') continue;
    out.push({ url: r.url, referrers: r.referrers, reason: r.error, ...(r.status ? { status: r.status } : {}) });
  }
  return out;
}

export async function writeManifest(outputDir: string, manifest: Manifest): Promise<string> {
  await fs.mkdir(dirOf(outputDir), { recursive: true });
  const file = path.join(dirOf(outputDir), 'manifest.json');
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

export async function readManifest(outputDir: string): Promise<Manifest | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dirOf(outputDir), 'manifest.json'), 'utf8')) as Manifest;
    if (!Array.isArray(parsed.files)) return undefined;
    // a hand-edited or damaged manifest must not break overwrite/merge
    parsed.files = parsed.files.filter(
      (f): f is PlacedFile => typeof f === 'object' && f !== null && typeof (f as { path?: unknown }).path === 'string',
    );
    return parsed;
  } catch {
    return undefined;
  }
}

export async function writeReport(outputDir: string, report: Report): Promise<string> {
  await fs.mkdir(dirOf(outputDir), { recursive: true });
  const file = path.join(dirOf(outputDir), 'report.json');
  await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}
