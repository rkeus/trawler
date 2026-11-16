import path from 'node:path';

/** Splits "a.svg#icon" into ["a.svg", "#icon"]. */
export function splitFragment(raw: string): [string, string] {
  const i = raw.indexOf('#');
  return i < 0 ? [raw, ''] : [raw.slice(0, i), raw.slice(i)];
}

/** Relative, percent-encoded href from one local file to another (both posix paths relative to the output root). */
export function relativeHref(fromFile: string, toFile: string): string {
  let rel = path.posix.relative(path.posix.dirname(fromFile), toFile);
  if (rel === '') rel = path.posix.basename(toFile);
  return rel
    .split('/')
    .map((s) => (s === '..' || s === '.' ? s : encodeURIComponent(s)))
    .join('/');
}
