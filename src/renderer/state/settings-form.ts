import type { Settings } from '../../shared/settings';

export type FieldKind = 'int' | 'number' | 'bool' | 'text' | 'lines' | 'select';
export type FieldGroup = 'download' | 'js' | 'application' | 'detection';

export interface FieldSpec {
  /** a Settings key, or a dotted path such as detection.weights.emptyMount */
  key: string;
  label: string;
  kind: FieldKind;
  group: FieldGroup;
  options?: readonly { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
}

export type DraftValue = string | boolean;
/** What the form holds: text for every input, booleans for switches. */
export type Draft = Record<string, DraftValue>;

const MODE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'static', label: 'Static' },
  { value: 'js', label: 'JS' },
] as const;
const FOLDER_OPTIONS = [
  { value: 'ask', label: 'Ask' },
  { value: 'overwrite', label: 'Overwrite' },
  { value: 'merge', label: 'Merge' },
  { value: 'fail', label: 'Fail' },
] as const;

export const FIELDS: readonly FieldSpec[] = [
  { key: 'mode', label: 'Mode', kind: 'select', group: 'download', options: MODE_OPTIONS },
  { key: 'downloadExternal', label: 'External (CDN) assets local', kind: 'bool', group: 'download' },
  { key: 'maxDepth', label: 'Max depth', kind: 'int', group: 'download' },
  { key: 'maxPages', label: 'Max pages', kind: 'int', group: 'download' },
  { key: 'concurrency', label: 'Concurrency', kind: 'int', group: 'download' },
  { key: 'retries', label: 'Retries', kind: 'int', group: 'download' },
  { key: 'requestTimeoutMs', label: 'Request timeout (ms)', kind: 'int', group: 'download' },
  { key: 'idleTimeoutMs', label: 'Body idle timeout (ms)', kind: 'int', group: 'download' },
  { key: 'requestDelayMs', label: 'Delay between requests (ms)', kind: 'int', group: 'download' },
  { key: 'memoryBodyLimitBytes', label: 'Largest body kept in memory (bytes)', kind: 'int', group: 'download' },
  { key: 'userAgent', label: 'User agent', kind: 'text', group: 'download', placeholder: 'Chromium default' },
  { key: 'respectRobotsTxt', label: 'Respect robots.txt', kind: 'bool', group: 'download' },
  { key: 'rewriteJsAbsoluteUrls', label: 'Rewrite absolute URLs in JS', kind: 'bool', group: 'download' },
  { key: 'verifyAfterDownload', label: 'Verify after download', kind: 'bool', group: 'download' },
  { key: 'nonEmptyFolder', label: 'Folder not empty', kind: 'select', group: 'download', options: FOLDER_OPTIONS },
  { key: 'excludePatterns', label: 'Exclude patterns (regex, one per line)', kind: 'lines', group: 'download' },
  { key: 'extraSeeds', label: 'Extra start URLs (one per line)', kind: 'lines', group: 'download' },

  { key: 'renderTimeoutMs', label: 'Render timeout (ms)', kind: 'int', group: 'js' },
  { key: 'networkIdleMs', label: 'Network idle (ms)', kind: 'int', group: 'js' },
  { key: 'renderConcurrency', label: 'Parallel windows', kind: 'int', group: 'js' },
  { key: 'analyzeRenderPages', label: 'Pages rendered by Analyze', kind: 'int', group: 'js' },
  { key: 'challengeTimeoutMs', label: 'Bot challenge timeout (ms)', kind: 'int', group: 'js' },
  { key: 'autoScroll', label: 'Auto-scroll pages', kind: 'bool', group: 'js' },

  { key: 'historySize', label: 'History size', kind: 'int', group: 'application' },
  { key: 'analysisCacheTtlMs', label: 'Reuse analysis for (ms)', kind: 'int', group: 'application', hint: '0 = never' },
  { key: 'analysisCacheMaxBytes', label: 'Analysis memory (bytes)', kind: 'int', group: 'application', hint: '0 = keep nothing' },
  { key: 'shutdownTimeoutMs', label: 'Quit waits for a job (ms)', kind: 'int', group: 'application' },
  { key: 'sessionResetTimeoutMs', label: 'Session clean-up limit (ms)', kind: 'int', group: 'application' },

  { key: 'detection.thresholds.static', label: 'Static below', kind: 'number', group: 'detection' },
  { key: 'detection.thresholds.js', label: 'JS from', kind: 'number', group: 'detection' },
  { key: 'detection.weights.emptyMount', label: 'Weight: empty mount', kind: 'number', group: 'detection' },
  { key: 'detection.weights.textRatio', label: 'Weight: text ratio', kind: 'number', group: 'detection' },
  { key: 'detection.weights.frameworkMarkers', label: 'Weight: framework markers', kind: 'number', group: 'detection' },
  { key: 'detection.weights.dataRequests', label: 'Weight: data requests', kind: 'number', group: 'detection' },
  { key: 'detection.weights.moduleScripts', label: 'Weight: module scripts', kind: 'number', group: 'detection' },
];

function getAt(obj: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
}

function setAt(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let o = target;
  for (const p of parts.slice(0, -1)) o = (o[p] ??= {}) as Record<string, unknown>;
  o[parts[parts.length - 1]!] = value;
}

export function toDraft(settings: Settings): Draft {
  const draft: Draft = {};
  for (const spec of FIELDS) {
    const v = getAt(settings, spec.key);
    draft[spec.key] = spec.kind === 'bool' ? v === true : spec.kind === 'lines' ? (v as string[]).join('\n') : String(v ?? '');
  }
  return draft;
}

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

function parseValue(spec: FieldSpec, raw: DraftValue | undefined): Parsed {
  const text = typeof raw === 'string' ? raw.trim() : '';
  switch (spec.kind) {
    case 'bool':
      return { ok: true, value: raw === true };
    case 'int':
      return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? { ok: true, value: Number(text) } : { ok: false, error: 'Enter a whole number.' };
    case 'number':
      return text !== '' && Number.isFinite(Number(text)) && Number(text) >= 0 ? { ok: true, value: Number(text) } : { ok: false, error: 'Enter a number.' };
    case 'text':
    case 'select':
      return { ok: true, value: text };
    case 'lines':
      return { ok: true, value: typeof raw === 'string' ? raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '') : [] };
  }
}

function parse(draft: Draft, keys?: readonly string[]): { parsed: [FieldSpec, unknown][]; errors: Record<string, string> } {
  const parsed: [FieldSpec, unknown][] = [];
  const errors: Record<string, string> = {};
  for (const spec of FIELDS) {
    if (keys && !keys.includes(spec.key)) continue;
    const r = parseValue(spec, draft[spec.key]);
    if (r.ok) parsed.push([spec, r.value]);
    else errors[spec.key] = r.error;
  }
  return { parsed, errors };
}

export type FormResult<T> = ({ ok: true } & T) | { ok: false; errors: Record<string, string> };

/** The values of the asked keys (all fields when `keys` is omitted), changed or not, as a nested settings object. */
export function parseFields(draft: Draft, keys?: readonly string[]): FormResult<{ values: Record<string, unknown> }> {
  const { parsed, errors } = parse(draft, keys);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const values: Record<string, unknown> = {};
  for (const [spec, value] of parsed) setAt(values, spec.key, value);
  return { ok: true, values };
}

/** Only the values that differ from `saved`, as a nested settings patch. */
export function buildPatch(draft: Draft, saved: Settings, keys?: readonly string[]): FormResult<{ patch: Record<string, unknown> }> {
  const { parsed, errors } = parse(draft, keys);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const patch: Record<string, unknown> = {};
  for (const [spec, value] of parsed) {
    if (JSON.stringify(value) !== JSON.stringify(getAt(saved, spec.key))) setAt(patch, spec.key, value);
  }
  return { ok: true, patch };
}
