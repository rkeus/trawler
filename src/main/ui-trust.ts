import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * True when `url` is a file: URL of a file inside `dir`. Compares decoded file paths, not URL strings: Node and
 * Chromium encode characters such as ~ [ ] differently, and Windows paths are case-insensitive.
 */
export function isFileInside(url: string, dir: string): boolean {
  if (!/^file:/i.test(url)) return false;
  let file: string;
  try {
    file = fileURLToPath(url);
  } catch {
    return false;
  }
  const rel = path.relative(dir, file);
  return rel !== '' && !path.isAbsolute(rel) && rel.split(path.sep)[0] !== '..';
}
