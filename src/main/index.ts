import os from 'node:os';
import { app, dialog } from 'electron';
import { APP_ID } from './app-id';
import { parseCliArgs } from './cli';
import { runCli } from './cli-runner';
import { startDesktopApp } from './desktop';
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
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
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
  void startDesktopApp().catch((err: unknown) => {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`fatal: ${detail}\n`);
    // a GUI app that only writes to stderr just vanishes; showErrorBox is safe before the app is ready
    dialog.showErrorBox('Trawler could not start', err instanceof Error ? err.message : String(err));
    app.exit(1);
  });
}
