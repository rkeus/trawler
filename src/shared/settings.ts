import type { DetectionThresholds, DetectionWeights, Mode } from './types';

export type NonEmptyFolderPolicy = 'ask' | 'overwrite' | 'merge' | 'fail';

export interface Settings {
  mode: Mode;
  downloadExternal: boolean;
  maxDepth: number;
  maxPages: number;
  concurrency: number;
  requestTimeoutMs: number;
  retries: number;
  requestDelayMs: number;
  renderTimeoutMs: number;
  networkIdleMs: number;
  /** hidden browser windows rendering pages at the same time (JS mode) */
  renderConcurrency: number;
  /** max silence while a response body is streaming */
  idleTimeoutMs: number;
  /** bodies larger than this stream to disk instead of memory */
  memoryBodyLimitBytes: number;
  autoScroll: boolean;
  analyzeRenderPages: number;
  /** '' means: use Chromium's default user agent */
  userAgent: string;
  respectRobotsTxt: boolean;
  excludePatterns: string[];
  extraSeeds: string[];
  rewriteJsAbsoluteUrls: boolean;
  nonEmptyFolder: NonEmptyFolderPolicy;
  verifyAfterDownload: boolean;
  historySize: number;
  detection: {
    thresholds: DetectionThresholds;
    weights: DetectionWeights;
  };
}

const DEFAULTS: Settings = {
  mode: 'auto',
  downloadExternal: true,
  maxDepth: 5,
  maxPages: 500,
  concurrency: 6,
  requestTimeoutMs: 30000,
  retries: 2,
  requestDelayMs: 0,
  renderTimeoutMs: 15000,
  networkIdleMs: 1000,
  renderConcurrency: 2,
  idleTimeoutMs: 30000,
  memoryBodyLimitBytes: 8388608,
  autoScroll: true,
  analyzeRenderPages: 5,
  userAgent: '',
  respectRobotsTxt: true,
  excludePatterns: [],
  extraSeeds: [],
  rewriteJsAbsoluteUrls: false,
  nonEmptyFolder: 'ask',
  verifyAfterDownload: true,
  historySize: 20,
  detection: {
    thresholds: { static: 0.3, js: 0.6 },
    weights: { emptyMount: 0.3, textRatio: 0.25, frameworkMarkers: 0.3, dataRequests: 0.1, moduleScripts: 0.05 },
  },
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** Deep-frozen defaults. Never mutate; resolveSettings() returns a deep clone. */
export const DEFAULT_SETTINGS: Readonly<Settings> = deepFreeze(DEFAULTS);

export interface ResolvedSettings {
  settings: Settings;
  warnings: string[];
}

type IntKey =
  | 'maxDepth'
  | 'maxPages'
  | 'concurrency'
  | 'requestTimeoutMs'
  | 'retries'
  | 'requestDelayMs'
  | 'renderTimeoutMs'
  | 'networkIdleMs'
  | 'renderConcurrency'
  | 'idleTimeoutMs'
  | 'memoryBodyLimitBytes'
  | 'analyzeRenderPages'
  | 'historySize';

const INT_RANGES: Record<IntKey, [number, number]> = {
  maxDepth: [0, 50],
  maxPages: [1, 100000],
  concurrency: [1, 32],
  requestTimeoutMs: [1000, 600000],
  retries: [0, 10],
  requestDelayMs: [0, 60000],
  renderTimeoutMs: [1000, 300000],
  networkIdleMs: [100, 30000],
  renderConcurrency: [1, 8],
  idleTimeoutMs: [1000, 600000],
  memoryBodyLimitBytes: [262144, 536870912],
  analyzeRenderPages: [1, 100],
  historySize: [0, 500],
};

type BoolKey = 'downloadExternal' | 'autoScroll' | 'respectRobotsTxt' | 'rewriteJsAbsoluteUrls' | 'verifyAfterDownload';
const BOOL_KEYS: readonly BoolKey[] = [
  'downloadExternal',
  'autoScroll',
  'respectRobotsTxt',
  'rewriteJsAbsoluteUrls',
  'verifyAfterDownload',
];

const MODES: readonly Mode[] = ['auto', 'static', 'js'];
const POLICIES: readonly NonEmptyFolderPolicy[] = ['ask', 'overwrite', 'merge', 'fail'];
const WEIGHT_KEYS: readonly (keyof DetectionWeights)[] = [
  'emptyMount',
  'textRatio',
  'frameworkMarkers',
  'dataRequests',
  'moduleScripts',
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidRegex(s: string): boolean {
  try {
    new RegExp(s);
    return true;
  } catch {
    return false;
  }
}

export function compileExcludePatterns(patterns: string[]): RegExp[] {
  return patterns.filter(isValidRegex).map((p) => new RegExp(p));
}

function resolveDetection(value: unknown, settings: Settings, warnings: string[]): void {
  if (!isRecord(value)) {
    warnings.push('detection: expected an object; using defaults');
    return;
  }
  if (value.thresholds !== undefined) {
    const t = value.thresholds;
    const s = isRecord(t) ? t.static : undefined;
    const j = isRecord(t) ? t.js : undefined;
    const st = typeof s === 'number' ? s : settings.detection.thresholds.static;
    const js = typeof j === 'number' ? j : settings.detection.thresholds.js;
    if (st >= 0 && js <= 1 && st < js) {
      settings.detection.thresholds = { static: st, js };
    } else {
      warnings.push('detection.thresholds: need 0 <= static < js <= 1; using defaults');
    }
  }
  if (value.weights !== undefined) {
    if (!isRecord(value.weights)) {
      warnings.push('detection.weights: expected an object; using defaults');
      return;
    }
    for (const [k, v] of Object.entries(value.weights)) {
      if (!(WEIGHT_KEYS as readonly string[]).includes(k)) {
        warnings.push(`detection.weights: unknown weight "${k}" ignored`);
        continue;
      }
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        warnings.push(`detection.weights.${k}: expected a non-negative number; using default`);
        continue;
      }
      settings.detection.weights[k as keyof DetectionWeights] = v;
    }
  }
}

export function resolveSettings(input: unknown): ResolvedSettings {
  const settings: Settings = structuredClone(DEFAULT_SETTINGS);
  const warnings: string[] = [];
  if (input === undefined || input === null) return { settings, warnings };
  if (!isRecord(input)) {
    warnings.push('Settings must be an object; using defaults');
    return { settings, warnings };
  }

  for (const [key, value] of Object.entries(input)) {
    if (Object.hasOwn(INT_RANGES, key)) {
      const k = key as IntKey;
      const [min, max] = INT_RANGES[k];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        warnings.push(`${k}: expected a number; using default ${settings[k]}`);
        continue;
      }
      const v = Math.round(value);
      const clamped = Math.min(max, Math.max(min, v));
      if (clamped !== v) warnings.push(`${k}: ${v} out of range [${min}, ${max}]; clamped to ${clamped}`);
      settings[k] = clamped;
      continue;
    }
    if ((BOOL_KEYS as readonly string[]).includes(key)) {
      const k = key as BoolKey;
      if (typeof value !== 'boolean') {
        warnings.push(`${k}: expected true/false; using default ${settings[k]}`);
        continue;
      }
      settings[k] = value;
      continue;
    }
    switch (key) {
      case 'mode':
        if (typeof value === 'string' && (MODES as readonly string[]).includes(value)) settings.mode = value as Mode;
        else warnings.push(`mode: expected one of ${MODES.join(', ')}; using default`);
        break;
      case 'nonEmptyFolder':
        if (typeof value === 'string' && (POLICIES as readonly string[]).includes(value))
          settings.nonEmptyFolder = value as NonEmptyFolderPolicy;
        else warnings.push(`nonEmptyFolder: expected one of ${POLICIES.join(', ')}; using default`);
        break;
      case 'userAgent':
        if (typeof value === 'string') settings.userAgent = value.trim();
        else warnings.push('userAgent: expected a string; using default');
        break;
      case 'excludePatterns':
        if (!Array.isArray(value)) {
          warnings.push('excludePatterns: expected a list of strings; using default');
          break;
        }
        settings.excludePatterns = [];
        for (const p of value) {
          if (typeof p === 'string' && isValidRegex(p)) settings.excludePatterns.push(p);
          else warnings.push(`excludePatterns: invalid regular expression ${JSON.stringify(p)} dropped`);
        }
        break;
      case 'extraSeeds':
        if (!Array.isArray(value)) {
          warnings.push('extraSeeds: expected a list of URLs; using default');
          break;
        }
        settings.extraSeeds = [];
        for (const s of value) {
          if (typeof s === 'string' && isHttpUrl(s)) settings.extraSeeds.push(s);
          else warnings.push(`extraSeeds: ${JSON.stringify(s)} is not an http(s) URL; dropped`);
        }
        break;
      case 'detection':
        resolveDetection(value, settings, warnings);
        break;
      default:
        warnings.push(`Unknown setting "${key}" ignored`);
    }
  }
  return { settings, warnings };
}
