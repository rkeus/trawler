import { detect } from '../core';
import type { Settings } from '../shared/settings';
import type { Detection } from '../shared/types';
import type { ResolvedSeed } from './crawl';
import { decodeBody } from './text';
import type { CaptureResult, Capturer } from './types';

export interface ArchitectureResult {
  detection: Detection;
  /** the start-page render, reusable by a JS-mode crawl */
  capture: CaptureResult;
}

/** Renders the start page and compares it with the raw HTML (spec §4.2). */
export async function detectArchitecture(
  seed: ResolvedSeed,
  capturer: Capturer,
  settings: Settings,
  signal: AbortSignal,
): Promise<ArchitectureResult> {
  const capture = await capturer.capture(seed.start, {
    timeoutMs: settings.renderTimeoutMs,
    networkIdleMs: settings.networkIdleMs,
    autoScroll: settings.autoScroll,
    signal,
  });
  const rawHtml = decodeBody(seed.response.body, seed.response.contentType).text;
  const detection = detect(
    { rawHtml, renderedHtml: capture.renderedHtml, dataRequests: capture.dataRequests },
    settings.detection,
  );
  return { detection, capture };
}
