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

/** Starts the built desktop app with its own profile folder. Run `npm run build:main` first. */
export async function launchApp(userDataDir: string): Promise<AppRun> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  env.TRAWLER_USER_DATA = userDataDir;
  const app = await _electron.launch({ executablePath: ELECTRON, args: ['.'], cwd: ROOT, env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

/** Calls window.trawler[name](...args) in the UI page. */
export function api<T = any>(run: AppRun, name: string, ...args: unknown[]): Promise<T> {
  return run.page.evaluate(
    ([n, a]) => (globalThis as any).trawler[n as string](...(a as unknown[])),
    [name, args] as const,
  ) as Promise<T>;
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
      const start = await trawler.startJob(req);
      const finished = await done;
      return { start, finished, events };
    } finally {
      offEvent();
      offDone();
    }
  }, request);
}
