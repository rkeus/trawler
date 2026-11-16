import type { Settings } from '../shared/settings';
import type { AssetKind, Detection } from '../shared/types';
import type { CrawlResult } from './crawl';

export interface AnalysisReport {
  seedUrl: string;
  mode: 'static' | 'js';
  detection?: Detection;
  /** fetched page URLs, sorted */
  pages: string[];
  assetCounts: Record<AssetKind, number>;
  /** sorted by count, descending */
  externalHosts: { host: string; count: number }[];
  warnings: string[];
  /** suggested setting changes for the download */
  recommended: Partial<Settings>;
}

const EMPTY_COUNTS = (): Record<AssetKind, number> => ({
  page: 0, css: 0, js: 0, image: 0, font: 0, media: 0, data: 0, other: 0,
});

export function buildAnalysisReport(
  crawl: CrawlResult,
  settings: Settings,
  mode: 'static' | 'js',
  detection: Detection | undefined,
): AnalysisReport {
  const records = [...crawl.records.values()];
  const pages = records.filter((r) => r.isPage && r.fetched && !r.duplicate && !r.error).map((r) => r.finalUrl).sort();
  const assetCounts = EMPTY_COUNTS();
  for (const r of records) {
    if (!r.isPage && !r.duplicate && !r.error && !r.skipped) assetCounts[r.kind]++;
  }

  const warnings = [...crawl.warnings];
  const recommended: Partial<Settings> = {};
  const challenges = records.filter((r) => r.errorReason === 'challenge').length;
  if (challenges > 0) {
    warnings.push(`Bot protection blocked ${challenges} request(s). Use fewer parallel requests and a delay.`);
    recommended.concurrency = 2;
    recommended.requestDelayMs = 500;
  }
  if (crawl.limitReached) recommended.maxPages = Math.min(100000, settings.maxPages * 2);
  if (detection && detection.verdict !== 'static') recommended.mode = 'js';
  if (crawl.counters.errors > 0) warnings.push(`${crawl.counters.errors} request(s) failed during analysis.`);

  return {
    seedUrl: crawl.seedUrl,
    mode,
    ...(detection ? { detection } : {}),
    pages,
    assetCounts,
    externalHosts: [...crawl.externalHosts].map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count),
    warnings,
    recommended,
  };
}
