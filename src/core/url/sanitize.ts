import path from 'node:path';
import { shortHash } from './hash';

export const MAX_SEGMENT_LENGTH = 100;

// Windows-forbidden characters, path separators and control characters.
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;

const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** Makes one decoded URL path segment safe as a Windows (and posix) file or directory name. */
export function sanitizeSegment(segment: string): string {
  let s = segment.replace(FORBIDDEN, '_').replace(/[. ]+$/, '');
  if (s === '') return '_';

  const dot = s.indexOf('.');
  const stem = dot < 0 ? s : s.slice(0, dot);
  const rest = dot < 0 ? '' : s.slice(dot);
  if (RESERVED.has(stem.toUpperCase())) s = `${stem}_${rest}`;

  if (s.length > MAX_SEGMENT_LENGTH) {
    const ext = path.posix.extname(s);
    const keepExt = ext.length <= 10 ? ext : '';
    const body = s.slice(0, s.length - keepExt.length);
    s = `${body.slice(0, MAX_SEGMENT_LENGTH - keepExt.length - 9)}-${shortHash(segment, 8)}${keepExt}`;
  }
  return s;
}
