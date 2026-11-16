import fs from 'node:fs/promises';
import path from 'node:path';
import { UrlMapper, computeRootPath, isHtmlContentType, rewriteCss, rewriteHtml } from '../core';
import type { Settings } from '../shared/settings';
import type { BlobStore } from './blob-store';
import type { CrawlRecord, CrawlResult } from './crawl';
import { rewriteJsAbsoluteUrls } from './rewrite-js';
import { decodeBody, encodeBody } from './text';
import type { PlacedFile } from './types';

export interface FinalizeOptions {
  outputDir: string;
  crawl: CrawlResult;
  blobStore: BlobStore;
  settings: Settings;
  progress?: FinalizeProgress;
}

export interface FinalizeResult {
  /** server path that maps to the output root, e.g. "/html/" (manifest basePath) */
  rootPath: string;
  files: PlacedFile[];
}

/** Caller-owned progress, so a failure mid-finalize can still record what was placed. */
export interface FinalizeProgress {
  rootPath?: string;
  files: PlacedFile[];
}

function byStableOrder(a: CrawlRecord, b: CrawlRecord): number {
  if (a.isPage !== b.isPage) return a.isPage ? -1 : 1;
  return a.finalUrl < b.finalUrl ? -1 : a.finalUrl > b.finalUrl ? 1 : 0;
}

/**
 * Places every successfully fetched body at its final local path, rewriting HTML and CSS refs
 * (and optionally absolute URLs in JS). Runs fully even after a cancel, so partial downloads are kept.
 */
export async function finalize(opts: FinalizeOptions): Promise<FinalizeResult> {
  const { crawl, blobStore, settings, outputDir } = opts;
  const host = crawl.scope.host;
  const isSameHost = (u: string): boolean => {
    try {
      return new URL(u).host === host;
    } catch {
      return false;
    }
  };

  const ok = [...crawl.records.values()].filter((r) => r.fetched && !r.error && !r.duplicate && r.blobId);
  ok.sort(byStableOrder); // "first claim wins" in UrlMapper → stable names across runs

  const rootPath = computeRootPath(
    crawl.scope.basePath,
    ok.filter((r) => isSameHost(r.finalUrl)).map((r) => new URL(r.finalUrl).pathname),
  );
  if (opts.progress) opts.progress.rootPath = rootPath;
  const mapper = new UrlMapper({ origin: crawl.scope.origin, rootPath });
  for (const r of ok) mapper.map(r.finalUrl, r.contentType);
  for (const [from, to] of crawl.aliases) mapper.alias(from, to);

  const resolveLocal = (abs: string): string | undefined => mapper.get(abs);
  const resolveLocalDir = (u: string): string | undefined => mapper.localDir(u);
  const aliasesByTarget = new Map<string, string[]>();
  for (const [from, to] of crawl.aliases) aliasesByTarget.set(to, [...(aliasesByTarget.get(to) ?? []), from]);

  const files: PlacedFile[] = opts.progress?.files ?? [];
  for (const r of ok) {
    const local = mapper.get(r.finalUrl)!;
    const target = path.join(outputDir, ...local.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });

    if (isHtmlContentType(r.contentType) || r.kind === 'css' || (r.kind === 'js' && settings.rewriteJsAbsoluteUrls)) {
      const { text, encoding } = decodeBody(await blobStore.get(r.blobId!), r.contentType);
      let out: string;
      if (isHtmlContentType(r.contentType)) out = rewriteHtml(text, r.finalUrl, local, resolveLocal, { resolveLocalDir });
      else if (r.kind === 'css') out = rewriteCss(text, r.finalUrl, local, resolveLocal);
      else out = rewriteJsAbsoluteUrls(text, resolveLocal, isSameHost, rootPath);
      await fs.writeFile(target, encodeBody(out, encoding));
    } else {
      await fs.copyFile(blobStore.pathOf(r.blobId!), target);
    }

    files.push({
      url: r.finalUrl,
      aliases: aliasesByTarget.get(r.finalUrl) ?? [],
      path: local,
      status: r.status,
      contentType: r.contentType,
      bytes: r.bytes,
      kind: r.kind,
    });
  }
  return { rootPath, files };
}
