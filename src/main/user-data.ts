import path from 'node:path';

/** Folder next to a portable exe that holds settings.json, history.json and app-state.json. */
export const PORTABLE_DATA_FOLDER = 'TrawlerData';

/**
 * Where the desktop app keeps its profile, or undefined for Electron's default (%APPDATA%/Trawler).
 * TRAWLER_USER_DATA wins (tests, scripts). The portable build's launcher sets PORTABLE_EXECUTABLE_DIR.
 */
export function chooseUserDataDir(env: Record<string, string | undefined>): string | undefined {
  const explicit = env.TRAWLER_USER_DATA?.trim();
  if (explicit) return path.resolve(explicit);
  const portable = env.PORTABLE_EXECUTABLE_DIR?.trim();
  if (portable) return path.resolve(portable, PORTABLE_DATA_FOLDER);
  return undefined;
}
