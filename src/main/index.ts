import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { parseCliArgs } from './cli';
import { runCli } from './cli-runner';

const EXIT_USAGE = 64;
const PROFILE_PREFIX = 'trawler-cli-profile-';
const STALE_PROFILE_MS = 60 * 60 * 1000;

/**
 * Headless runs get a throwaway profile: they never touch the desktop app's profile (settings, history) or each
 * other's caches. Chromium keeps the folder locked until the process is gone, so stale ones are swept at the
 * next start instead of on exit.
 */
function useThrowawayProfile(): void {
  const tmp = os.tmpdir();
  try {
    for (const name of fs.readdirSync(tmp)) {
      if (!name.startsWith(PROFILE_PREFIX)) continue;
      const dir = path.join(tmp, name);
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs > STALE_PROFILE_MS) fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // in use or already gone
      }
    }
  } catch {
    // temp folder not readable: nothing to sweep
  }
  app.setPath('userData', fs.mkdtempSync(path.join(tmp, PROFILE_PREFIX)));
}

/** In headless mode a crash must end the process, not open Electron's error dialog. */
function exitOnCrash(): void {
  process.on('uncaughtException', (err) => {
    process.stderr.write(`fatal: ${err.stack ?? err.message}\n`);
    app.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`);
  });
}

app.setName('Trawler');
const parsed = parseCliArgs(process.argv);

if (parsed.kind === 'error') {
  // exit at once: waiting for "ready" would start Chromium (GPU, caches) only to print an error
  process.stderr.write(`${parsed.message}\n`, () => process.exit(EXIT_USAGE));
} else if (parsed.kind === 'cli') {
  exitOnCrash();
  useThrowawayProfile();
  app.disableHardwareAcceleration(); // headless runs need no GPU
  // hidden capture windows open and close all the time: never quit because of that
  app.on('window-all-closed', () => undefined);
  void app.whenReady().then(async () => {
    let code = 1;
    try {
      code = await runCli(parsed.args);
    } catch (err) {
      process.stderr.write(`fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    }
    app.exit(code);
  });
} else {
  app.on('window-all-closed', () => app.quit());
  void app.whenReady().then(() => {
    const win = new BrowserWindow({ width: 900, height: 600, title: 'Trawler' });
    const page =
      '<!doctype html><meta charset="utf-8"><title>Trawler</title>' +
      '<body style="font-family:system-ui;padding:2rem"><h1>Trawler</h1>' +
      '<p>The desktop interface arrives in Plan 3. Until then, use the command line:</p>' +
      '<pre>npm start -- --trawler-cli --url=&lt;url&gt; --out=&lt;folder&gt;</pre></body>';
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  });
}
