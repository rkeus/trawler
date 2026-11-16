function parentDir(dir: string): string {
  if (dir === '/') return '/';
  const trimmed = dir.slice(0, -1);
  return trimmed.slice(0, trimmed.lastIndexOf('/') + 1);
}

/**
 * Smallest directory (ending in "/") that contains the directory of `basePath` and every same-host pathname given.
 * Used as the local output root: "/html/" → files under /html/ land at the output root.
 */
export function computeRootPath(basePath: string, pathnames: Iterable<string>): string {
  // a base path without trailing slash is a file path: use its directory
  let root = basePath.slice(0, basePath.lastIndexOf('/') + 1) || '/';
  for (const p of pathnames) {
    while (root !== '/' && !p.startsWith(root)) root = parentDir(root);
  }
  return root;
}
