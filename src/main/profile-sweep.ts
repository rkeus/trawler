import fs from 'node:fs';
import path from 'node:path';

export const PROFILE_PREFIX = 'trawler-cli-profile-';
export const PID_FILE = 'trawler.pid';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0: existence check only
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'; // exists, but owned by someone else
  }
}

/**
 * Removes throwaway CLI profiles older than `maxAgeMs` whose owning process is gone. A profile still used by
 * a running job (its pid file names a live process) is never touched. Best effort: locked files are skipped.
 */
export function sweepProfiles(root: string, maxAgeMs: number): void {
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(PROFILE_PREFIX)) continue;
    const dir = path.join(root, name);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs <= maxAgeMs) continue;
      const pid = Number(fs.readFileSync(path.join(dir, PID_FILE), 'utf8'));
      if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) continue;
    } catch {
      // no pid file: an old profile from before pid files existed, or a broken one; fall through and remove it
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // locked or already gone
    }
  }
}

/** Creates a new throwaway profile folder that records the current process id. */
export function createProfile(root: string): string {
  const dir = fs.mkdtempSync(path.join(root, PROFILE_PREFIX));
  fs.writeFileSync(path.join(dir, PID_FILE), String(process.pid));
  return dir;
}
