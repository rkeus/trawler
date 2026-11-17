import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type PathFlavor = 'win32' | 'posix';

const NATIVE: PathFlavor = process.platform === 'win32' ? 'win32' : 'posix';

/**
 * True when `url` is a file: URL of a file inside `dir`. Compares decoded file paths, not URL strings: Node and
 * Chromium encode characters such as ~ [ ] differently, and Windows paths are case-insensitive.
 * `flavor` exists for tests; the app uses the platform's own rules.
 */
export function isFileInside(url: string, dir: string, flavor: PathFlavor = NATIVE): boolean {
  if (!/^file:/i.test(url)) return false;
  const p = flavor === 'win32' ? path.win32 : path.posix;
  let file: string;
  try {
    file = fileURLToPath(url, { windows: flavor === 'win32' });
  } catch {
    return false;
  }
  const rel = p.relative(dir, file);
  return rel !== '' && !p.isAbsolute(rel) && rel.split(p.sep)[0] !== '..';
}
