import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTmpDir } from '../../helpers/tmp';
import { createProfile, sweepProfiles, PROFILE_PREFIX, PID_FILE } from '../../../src/main/profile-sweep';

const HOUR = 60 * 60 * 1000;

function profile(root: string, name: string, pid: number | null, ageMs: number): string {
  const dir = path.join(root, `${PROFILE_PREFIX}${name}`);
  fs.mkdirSync(dir);
  if (pid !== null) fs.writeFileSync(path.join(dir, PID_FILE), String(pid));
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(dir, t, t);
  return dir;
}

describe('profile sweep', () => {
  it('removes only old profiles whose process is gone', async () => {
    const root = await makeTmpDir('profiles');
    const oldDead = profile(root, 'olddead', 999999, 2 * HOUR);
    const oldNoPid = profile(root, 'oldnopid', null, 2 * HOUR);
    const oldAlive = profile(root, 'oldalive', process.pid, 2 * HOUR);
    const fresh = profile(root, 'fresh', 999999, 0);
    fs.mkdirSync(path.join(root, 'unrelated-folder'));
    sweepProfiles(root, HOUR);
    expect(fs.existsSync(oldDead)).toBe(false);
    expect(fs.existsSync(oldNoPid)).toBe(false);
    expect(fs.existsSync(oldAlive)).toBe(true);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(path.join(root, 'unrelated-folder'))).toBe(true);
  });

  it('creates a profile with the current pid', async () => {
    const root = await makeTmpDir('profiles');
    const dir = createProfile(root);
    expect(path.basename(dir).startsWith(PROFILE_PREFIX)).toBe(true);
    expect(fs.readFileSync(path.join(dir, PID_FILE), 'utf8')).toBe(String(process.pid));
  });
});
