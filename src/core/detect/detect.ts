import type {
  Detection,
  DetectionSignals,
  DetectionThresholds,
  DetectionWeights,
  Verdict,
} from '../../shared/types';
import { findFrameworkMarkers, findUiKits } from './markers';
import { analyzeStructure } from './structure';

export interface DetectInput {
  rawHtml: string;
  renderedHtml: string;
  /** JSON XHR/fetch responses observed while rendering */
  dataRequests: number;
}

export interface DetectOptions {
  weights: DetectionWeights;
  thresholds: DetectionThresholds;
}

const ratio = (a: number, b: number): number => (b === 0 ? 1 : a / b);
const round3 = (x: number): number => Math.round(x * 1000) / 1000;

export function computeSignals(rawHtml: string, renderedHtml: string, dataRequests: number): DetectionSignals {
  const raw = analyzeStructure(rawHtml);
  const rendered = analyzeStructure(renderedHtml);
  const markers = new Set([...findFrameworkMarkers(rawHtml), ...findFrameworkMarkers(renderedHtml)]);
  return {
    textRatio: round3(ratio(raw.textLength, rendered.textLength)),
    elementRatio: round3(ratio(raw.elementCount, rendered.elementCount)),
    emptyMount: raw.emptyMountIds.length > 0,
    mountIds: raw.emptyMountIds,
    frameworkMarkers: [...markers],
    dataRequests,
    moduleScripts: raw.moduleScripts,
  };
}

export function scoreSignals(s: DetectionSignals, w: DetectionWeights): number {
  const score =
    w.emptyMount * (s.emptyMount ? 1 : 0) +
    w.textRatio * (1 - Math.min(s.textRatio, 1)) +
    w.frameworkMarkers * (s.frameworkMarkers.length > 0 ? 1 : 0) +
    w.dataRequests * Math.min(s.dataRequests / 3, 1) +
    w.moduleScripts * (s.moduleScripts > 0 ? 1 : 0);
  return round3(score);
}

export function verdictFor(score: number, t: DetectionThresholds): Verdict {
  if (score < t.static) return 'static';
  if (score > t.js) return 'js';
  return 'hybrid';
}

export function explainSignals(s: DetectionSignals): string[] {
  const out: string[] = [];
  if (s.emptyMount) {
    out.push(`Empty mount point ${s.mountIds.join(', ')} in the raw HTML: content is injected by JavaScript.`);
  }
  const pct = Math.round(Math.min(s.textRatio, 1) * 100);
  out.push(
    s.textRatio < 0.5
      ? `Raw HTML holds only ${pct}% of the rendered text.`
      : `Raw HTML already holds ${pct}% of the rendered text.`,
  );
  if (s.frameworkMarkers.length > 0) out.push(`Framework markers found: ${s.frameworkMarkers.join(', ')}.`);
  if (s.dataRequests > 0) out.push(`${s.dataRequests} JSON data request(s) during render.`);
  if (s.moduleScripts > 0) out.push(`${s.moduleScripts} ES module script(s).`);
  return out;
}

export function detect(input: DetectInput, opts: DetectOptions): Detection {
  const signals = computeSignals(input.rawHtml, input.renderedHtml, input.dataRequests);
  const score = scoreSignals(signals, opts.weights);
  return {
    verdict: verdictFor(score, opts.thresholds),
    score,
    frameworks: signals.frameworkMarkers,
    uiKits: findUiKits(input.rawHtml),
    signals,
    explanations: explainSignals(signals),
  };
}
