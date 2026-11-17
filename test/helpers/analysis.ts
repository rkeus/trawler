import type { JobResult } from '../../src/engine';
import type { Detection } from '../../src/shared/types';

export const DETECTION: Detection = {
  verdict: 'hybrid',
  score: 0.3,
  frameworks: ['React'],
  uiKits: ['Bootstrap'],
  signals: { textRatio: 1, elementRatio: 1, emptyMount: false, mountIds: ['root'], frameworkMarkers: ['react'], dataRequests: 2, moduleScripts: 0 },
  explanations: ['Framework markers found (React).', 'Mount #root is not empty.'],
};

/** A finished analysis of https://example.com/template/index.html that recommends JS mode and 1000 pages. */
export function analysisResult(over: Partial<NonNullable<JobResult['analysis']>> = {}): JobResult {
  return {
    kind: 'analyze',
    status: 'done',
    mode: 'js',
    detection: DETECTION,
    counters: { pagesDone: 3, pagesQueued: 0, assetsDone: 9, assetsQueued: 0, bytes: 4096, errors: 0 },
    warnings: [],
    analysis: {
      seedUrl: 'https://example.com/template/index.html',
      mode: 'js',
      detection: DETECTION,
      pages: [
        'https://example.com/template/index.html',
        'https://example.com/template/about.html',
        'https://example.com/template/blog/post-1.html',
      ],
      assetCounts: { page: 0, css: 2, js: 3, image: 4, font: 0, media: 0, data: 0, other: 0 },
      externalHosts: [{ host: 'cdn.example', count: 5 }],
      warnings: ['robots.txt disallows /admin/'],
      recommended: { mode: 'js', maxPages: 1000 },
      ...over,
    },
  };
}
