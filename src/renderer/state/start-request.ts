import type { JobKind } from '../../engine';
import type { StartJobRequest } from '../../shared/ipc';
import type { Mode } from '../../shared/types';

export type UrlResult = { ok: true; url: string } | { ok: false; error: string };

/** Accepts what a person types: trims, adds https:// when there is no scheme, allows only http(s). */
export function normalizeUrlInput(raw: string): UrlResult {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'Enter the template URL.' };
  // a scheme counts only with "://", so "localhost:8080/a" is a host and port, not a scheme
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, error: 'This does not look like a valid URL.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'Only http and https URLs are supported.' };
  if (u.hostname === '') return { ok: false, error: 'This does not look like a valid URL.' };
  return { ok: true, url: u.href };
}

export interface StartForm {
  kind: JobKind;
  url: string;
  outputDir: string | undefined;
  mode: Mode;
  downloadExternal: boolean;
}

export type BuildResult = { ok: true; request: StartJobRequest } | { ok: false; error: string };

/** The start screen's form as a job request. Mode and the CDN switch are per-job changes on top of the saved settings. */
export function buildStartRequest(form: StartForm): BuildResult {
  const url = normalizeUrlInput(form.url);
  if (!url.ok) return url;
  if (form.kind === 'download' && !form.outputDir) return { ok: false, error: 'Choose an output folder first.' };
  return {
    ok: true,
    request: {
      kind: form.kind,
      seedUrl: url.url,
      ...(form.kind === 'download' && form.outputDir ? { outputDir: form.outputDir } : {}),
      settings: { mode: form.mode, downloadExternal: form.downloadExternal },
    },
  };
}
