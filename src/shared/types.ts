export type Mode = 'auto' | 'static' | 'js';
export type Verdict = 'static' | 'hybrid' | 'js';

export type AssetKind = 'page' | 'css' | 'js' | 'image' | 'font' | 'media' | 'data' | 'other';

export type RefSource =
  | 'html-attr'
  | 'srcset'
  | 'inline-style'
  | 'style-block'
  | 'css-url'
  | 'css-import';

/** A URL reference found in a document. `url` is absolute and normalized (no fragment). */
export interface Ref {
  url: string;
  raw: string;
  kind: AssetKind;
  source: RefSource;
}

export interface ParsedHtml {
  assets: Ref[];
  pages: Ref[];
}

export interface DetectionSignals {
  /** visible text length raw / rendered (1 when rendered is empty) */
  textRatio: number;
  /** element count raw / rendered (1 when rendered is empty) */
  elementRatio: number;
  emptyMount: boolean;
  mountIds: string[];
  frameworkMarkers: string[];
  dataRequests: number;
  moduleScripts: number;
}

export interface DetectionWeights {
  emptyMount: number;
  textRatio: number;
  frameworkMarkers: number;
  dataRequests: number;
  moduleScripts: number;
}

export interface DetectionThresholds {
  static: number;
  js: number;
}

export interface Detection {
  verdict: Verdict;
  score: number;
  frameworks: string[];
  uiKits: string[];
  signals: DetectionSignals;
  explanations: string[];
}

/** Returns the local path (relative to the output root, posix separators) for an absolute URL, or undefined if it was not downloaded. */
export type ResolveLocal = (absUrl: string) => string | undefined;
