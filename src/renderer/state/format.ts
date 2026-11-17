import type { HistoryEntry } from '../../shared/ipc';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 && v < 1000 && i < 2 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "17 Nov 10:12" in local time; '' for an unreadable date. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "example.com/template" for the Recent list. */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/index\.html?$/i, '').replace(/\/+$/, '');
    return u.host + path;
  } catch {
    return url;
  }
}

export interface ResultText {
  text: string;
  tone: 'ok' | 'warn' | 'err' | 'muted';
}

/** One line about how a history entry ended. */
export function describeResult(e: HistoryEntry): ResultText {
  if (e.status === 'failed') return { text: e.error ? `failed: ${e.error}` : 'failed', tone: 'err' };
  if (e.status === 'cancelled') return { text: 'cancelled', tone: 'warn' };
  if (e.kind === 'analyze') return { text: `${e.pagesFound ?? 0} pages found`, tone: 'muted' };
  const pages = `${e.counters.pagesDone} pages`;
  if (e.verify && e.verify.missing > 0) return { text: `${pages} - ${e.verify.missing} missing files`, tone: 'warn' };
  if (e.status === 'done_with_errors') return { text: `${pages} - ${e.counters.errors} errors`, tone: 'warn' };
  return { text: e.verify ? `${pages} - verified` : pages, tone: 'ok' };
}
