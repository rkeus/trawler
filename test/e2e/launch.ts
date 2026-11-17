import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELECTRON = createRequire(import.meta.url)('electron') as string;

export interface AppRun {
  app: ElectronApplication;
  page: Page;
}

function cleanEnv(userDataDir: string | undefined, extraEnv: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE' && key !== 'TRAWLER_USER_DATA') env[key] = value;
  }
  if (userDataDir !== undefined) env.TRAWLER_USER_DATA = userDataDir;
  return { ...env, ...extraEnv };
}

/** Waits for the first window; if that fails the app is closed so no Trawler process is left behind. */
async function attach(app: ElectronApplication): Promise<AppRun> {
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    return { app, page };
  } catch (err) {
    await app.close().catch(() => undefined);
    throw err;
  }
}

/** Starts the built desktop app with its own profile folder. Run `npm run build:main` first. */
export async function launchApp(userDataDir: string, appDir: string = ROOT): Promise<AppRun> {
  const app = await _electron.launch({ executablePath: ELECTRON, args: [appDir], cwd: appDir, env: cleanEnv(userDataDir) });
  return attach(app);
}

/**
 * The packaged app: release/win-unpacked/Trawler.exe from `npm run pack`, or the exe named by TRAWLER_EXE.
 * The installed or unpacked Trawler.exe only; the portable exe is an installer stub that Playwright cannot attach to.
 */
export const PACKAGED_EXE = process.env.TRAWLER_EXE ?? path.join(ROOT, 'release', 'win-unpacked', 'Trawler.exe');

/** Starts the packaged app (no source tree involved) with its own profile folder; undefined leaves TRAWLER_USER_DATA unset. */
export async function launchPackaged(userDataDir: string | undefined, extraEnv?: Record<string, string>): Promise<AppRun> {
  const app = await _electron.launch({ executablePath: PACKAGED_EXE, args: [], env: cleanEnv(userDataDir, extraEnv) });
  return attach(app);
}

/** Calls window.trawler[name](...args) in the UI page and unwraps the reply; a failed reply throws its message. */
export async function api<T = any>(run: AppRun, name: string, ...args: unknown[]): Promise<T> {
  const reply = (await run.page.evaluate(
    ([n, a]) => (globalThis as any).trawler[n as string](...(a as unknown[])),
    [name, args] as const,
  )) as { ok: boolean; value?: T; error?: string };
  if (!reply.ok) throw new Error(reply.error);
  return reply.value as T;
}

/** Starts a job from the UI page and resolves with its start reply, finished message and events. */
export function runJobInApp(run: AppRun, request: unknown): Promise<{ start: any; finished: any; events: any[] }> {
  return run.page.evaluate(async (req) => {
    const trawler = (globalThis as any).trawler;
    const events: any[] = [];
    let resolveDone!: (msg: any) => void;
    const done = new Promise<any>((resolve) => (resolveDone = resolve));
    const offEvent = trawler.onJobEvent((msg: any) => events.push(msg));
    const offDone = trawler.onJobFinished((msg: any) => resolveDone(msg));
    try {
      const reply = await trawler.startJob(req);
      if (!reply.ok) throw new Error(reply.error);
      const start = reply.value;
      const finished = await done;
      return { start, finished, events };
    } finally {
      offEvent();
      offDone();
    }
  }, request);
}

/** Copies the built app (package.json + out/) into `dir`, e.g. to run it from an unusual folder name. */
export async function copyBuiltApp(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  await fs.cp(path.join(ROOT, 'out'), path.join(dir, 'out'), { recursive: true });
  return dir;
}
