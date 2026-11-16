export const CLI_FLAG = '--trawler-cli';

export const CLI_USAGE = [
  'Usage: trawler --trawler-cli --url=<url> [--out=<folder>] [--kind=download|analyze] [--mode=auto|static|js]',
  '                [--policy=overwrite|merge|fail] [--settings=<json>]',
  'On Windows, write --url=<url> (with "=") or put -- before the options: Electron refuses to start when a',
  'URL argument is followed by more arguments. `npm start -- --trawler-cli ...` does this for you.',
].join('\n');

export interface CliArgs {
  kind: 'download' | 'analyze';
  url: string;
  out?: string;
  mode?: 'auto' | 'static' | 'js';
  policy?: 'overwrite' | 'merge' | 'fail';
  /** partial settings, validated later by resolveSettings */
  settings?: Record<string, unknown>;
}

export type CliParse = { kind: 'app' } | { kind: 'cli'; args: CliArgs } | { kind: 'error'; message: string };

const KNOWN = new Set(['url', 'out', 'kind', 'mode', 'policy', 'settings']);

const error = (message: string): CliParse => ({ kind: 'error', message: `${message}\n${CLI_USAGE}` });

/** Parses process.argv. Without --trawler-cli the desktop app starts; unknown switches (Chromium, Electron) are ignored. */
export function parseCliArgs(argv: readonly string[]): CliParse {
  if (!argv.includes(CLI_FLAG)) return { kind: 'app' };

  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--') || arg === CLI_FLAG) continue;
    const eq = arg.indexOf('=');
    const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    if (!KNOWN.has(key)) continue;
    let value: string | undefined;
    if (eq >= 0) {
      value = arg.slice(eq + 1);
    } else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return error(`--${key} needs a value`);
      i++;
    }
    values.set(key, value);
  }

  const url = values.get('url');
  if (!url) return error('--url is required');
  const kind = values.get('kind') ?? 'download';
  if (kind !== 'download' && kind !== 'analyze') return error('--kind must be download or analyze');
  const out = values.get('out');
  if (kind === 'download' && !out) return error('--out is required for downloads');
  const mode = values.get('mode');
  if (mode !== undefined && mode !== 'auto' && mode !== 'static' && mode !== 'js') {
    return error('--mode must be auto, static or js');
  }
  const policy = values.get('policy');
  if (policy !== undefined && policy !== 'overwrite' && policy !== 'merge' && policy !== 'fail') {
    return error('--policy must be overwrite, merge or fail');
  }
  let settings: Record<string, unknown> | undefined;
  const rawSettings = values.get('settings');
  if (rawSettings !== undefined) {
    try {
      const parsed: unknown = JSON.parse(rawSettings);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      settings = parsed as Record<string, unknown>;
    } catch {
      return error('--settings must be a JSON object');
    }
  }

  return {
    kind: 'cli',
    args: {
      kind,
      url,
      ...(out ? { out } : {}),
      ...(mode ? { mode } : {}),
      ...(policy ? { policy } : {}),
      ...(settings ? { settings } : {}),
    },
  };
}
