import os from 'node:os';
import { app, BrowserWindow } from 'electron';
import { parseCliArgs } from './cli';
import { runCli } from './cli-runner';
import { createProfile, sweepProfiles } from './profile-sweep';

const EXIT_USAGE = 64;

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
  // headless runs get a throwaway profile: they never touch the desktop app's profile or each other's caches
  sweepProfiles(os.tmpdir(), 60 * 60 * 1000);
  app.setPath('userData', createProfile(os.tmpdir()));
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
