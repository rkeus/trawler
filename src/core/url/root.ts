function parentDir(dir: string): string {
  if (dir === '/') return '/';
  const trimmed = dir.slice(0, -1);
  return trimmed.slice(0, trimmed.lastIndexOf('/') + 1);
}

/**
 * Smallest directory (ending in "/") that contains `basePath` and every same-host pathname given.
 * Used as the local output root: "/html/" → files under /html/ land at the output root.
 */
export function computeRootPath(basePath: string, pathnames: Iterable<string>): string {
  let root = basePath.endsWith('/') ? basePath : `${basePath}/`;
  for (const p of pathnames) {
    while (root !== '/' && !p.startsWith(root)) root = parentDir(root);
  }
  return root;
}
