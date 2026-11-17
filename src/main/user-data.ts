import path from 'node:path';
import { isNetworkPath } from './ipc-handlers';

/** Folder next to a portable exe that holds settings.json, history.json and app-state.json. */
export const PORTABLE_DATA_FOLDER = 'TrawlerData';

/**
 * What electron-builder's portable launcher puts in PORTABLE_EXECUTABLE_APP_FILENAME for this app.
 * Evidence: node_modules/app-builder-lib/templates/nsis/portable.nsi:79 sets it to ${APP_FILENAME}, and
 * node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js:270 defines APP_FILENAME as
 * getWindowsInstallationDirName(appInfo, !oneClick || isPerMachine); the portable target has empty options
 * (NsisTarget.js:62-64), so that is appInfo.sanitizedName, the package.json name "trawler". Compared case-insensitively.
 */
export const PORTABLE_APP_FILENAME = 'trawler';

/**
 * The portable data folder, or undefined when this is not our own portable exe. The launcher sets
 * PORTABLE_EXECUTABLE_DIR for every app built with electron-builder, so the app file name must match too.
 */
export function portableDataDir(env: Record<string, string | undefined>): string | undefined {
  const portable = env.PORTABLE_EXECUTABLE_DIR?.trim();
  const appFilename = env.PORTABLE_EXECUTABLE_APP_FILENAME?.trim();
  if (!portable || appFilename?.toLowerCase() !== PORTABLE_APP_FILENAME) return undefined;
  return path.resolve(portable, PORTABLE_DATA_FOLDER);
}

/**
 * Where the desktop app keeps its profile, or undefined for Electron's default (%APPDATA%\Trawler).
 * TRAWLER_USER_DATA wins (tests, scripts). Our portable build's launcher sets PORTABLE_EXECUTABLE_DIR.
 */
export function chooseUserDataDir(env: Record<string, string | undefined>): string | undefined {
  const explicit = env.TRAWLER_USER_DATA?.trim();
  if (explicit) return path.resolve(explicit);
  return portableDataDir(env);
}

/** The file system calls checkPortableDir needs (node:fs fits). */
export interface PortableFs {
  mkdirSync(dir: string, options: { recursive: true }): unknown;
  accessSync(dir: string, mode: number): void;
  constants: { W_OK: number };
}

/** Whether a portable data folder can be used: not a UNC/device path, creatable and writable. */
export function checkPortableDir(dir: string, fsLike: PortableFs): { ok: true } | { ok: false; warning: string } {
  const refuse = (why: string): { ok: false; warning: string } => ({
    ok: false,
    warning: `The portable data folder ${dir} is not usable (${why}); using the default profile.`,
  });
  if (isNetworkPath(dir)) return refuse('network and device paths are not supported');
  try {
    fsLike.mkdirSync(dir, { recursive: true });
    fsLike.accessSync(dir, fsLike.constants.W_OK);
  } catch (err) {
    return refuse(err instanceof Error ? err.message : String(err));
  }
  return { ok: true };
}

/** The profile folder to use plus a startup warning when the portable folder was refused. */
export function resolveUserData(env: Record<string, string | undefined>, fsLike: PortableFs): { dir?: string; warning?: string } {
  const explicit = env.TRAWLER_USER_DATA?.trim();
  if (explicit) return { dir: path.resolve(explicit) };
  const portable = portableDataDir(env);
  if (!portable) return {};
  const checked = checkPortableDir(portable, fsLike);
  return checked.ok ? { dir: portable } : { warning: checked.warning };
}
