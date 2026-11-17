import path from 'node:path';
import { app, dialog, Menu, session, shell, type BrowserWindow, type OpenDialogOptions } from 'electron';
import { sleep, TRAWLER_VERSION } from '../engine';
import { IPC_EVENTS } from '../shared/ipc';
import { AppSessions } from './app-sessions';
import { AppStateStore } from './app-state-store';
import { HistoryStore } from './history-store';
import { registerIpc, sendTo } from './ipc';
import { createHandlers } from './ipc-handlers';
import { JobManager } from './job-manager';
import { createElectronPorts } from './ports';
import { PreviewManager } from './preview-manager';
import { SettingsStore } from './settings-store';
import { isFileInside } from './ui-trust';
import { chooseUserDataDir } from './user-data';
import { createMainWindow, RENDERER_DIR } from './window';

/**
 * Starts the desktop app: stores in userData, the job and preview managers, IPC, and the window.
 * TRAWLER_USER_DATA overrides the profile folder (tests); a portable exe keeps it in TrawlerData beside the exe.
 */
export async function startDesktopApp(): Promise<void> {
  const override = process.env.TRAWLER_USER_DATA;
  if (override) app.setPath('userData', path.resolve(override));
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  let mainWindow: BrowserWindow | undefined;
  // quitting cancels a running job (partial manifest written) and stops the preview first, within shutdownTimeoutMs
  let quitting = false;
  let shutdownDone = false;
  // a second launch while this instance is shutting down: start again once the shutdown is done
  let relaunchAfterQuit = false;
  app.on('second-instance', () => {
    if (quitting) {
      relaunchAfterQuit = true;
      return;
    }
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => app.quit());

  await app.whenReady();
  Menu.setApplicationMenu(null); // the UI has its own chrome
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const userData = app.getPath('userData');
  const settings = new SettingsStore(SettingsStore.fileIn(userData));
  const history = new HistoryStore(HistoryStore.fileIn(userData));
  const appState = new AppStateStore(AppStateStore.fileIn(userData));
  const [settingsSnapshot, historyWarnings] = await Promise.all([settings.load(), history.load(), appState.load()]);
  const startupWarnings = [...settingsSnapshot.warnings, ...historyWarnings, ...appState.loadWarnings()];

  const sessions = new AppSessions();
  const send = (channel: string, payload: unknown): void => sendTo(mainWindow?.webContents, channel, payload);
  const jobs = new JobManager({
    settings: () => settings.get(),
    createPorts: async (s) => {
      const { timedOut } = await sessions.reset(s.userAgent, s.sessionResetTimeoutMs);
      if (timedOut) process.stderr.write('emptying the browser sessions timed out; starting the job anyway\n');
      return createElectronPorts(s, sessions);
    },
    record: (entry) => history.add(entry, settings.get().historySize),
    onEvent: (msg) => send(IPC_EVENTS.jobEvent, msg),
    onFinished: (msg) => send(IPC_EVENTS.jobFinished, msg),
  });
  const preview = new PreviewManager();

  registerIpc(
    createHandlers({
      settings,
      history,
      appState,
      jobs,
      preview,
      info: { version: TRAWLER_VERSION, userDataDir: userData, startupWarnings },
      chooseFolder: async (defaultPath) => {
        const options: OpenDialogOptions = {
          properties: ['openDirectory', 'createDirectory'],
          ...(defaultPath ? { defaultPath } : {}),
        };
        const picked = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
        return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0]!;
      },
      openPath: async (target) => {
        const error = await shell.openPath(target);
        if (error) throw new Error(error);
      },
      openExternal: (url) => shell.openExternal(url),
    }),
    // only the app window's own UI page may call the API
    (event) => event.sender === mainWindow?.webContents && isFileInside(event.senderFrame?.url ?? '', RENDERER_DIR),
  );

  // quitting cancels a running job (partial manifest written) and stops the preview first, within shutdownTimeoutMs
  const timedOut = Symbol('timed out');
  const shutdown = (): Promise<unknown> =>
    Promise.race([
      Promise.allSettled([jobs.shutdown(), preview.stop()]),
      sleep(settings.get().shutdownTimeoutMs).then(() => timedOut),
    ]);
  const quitAfterShutdown = (): void => {
    if (quitting) return;
    quitting = true;
    void shutdown().then((outcome) => {
      if (relaunchAfterQuit) app.relaunch();
      if (outcome === timedOut) {
        process.stderr.write('shutdown timed out; exiting\n');
        app.exit(0);
      } else {
        shutdownDone = true;
        app.quit();
      }
    });
  };

  app.on('before-quit', (event) => {
    if (shutdownDone) return;
    // every quit request while the shutdown is still running (window-all-closed, the window's 'closed') is held back too
    event.preventDefault();
    quitAfterShutdown();
  });

  mainWindow = createMainWindow();
  // Windows logoff or shutdown skips 'before-quit': run the same shutdown, so a running job still writes its partial
  // manifest. Windows may end the process before it is done, so this is best effort.
  mainWindow.on('session-end', () => quitAfterShutdown());
  mainWindow.on('closed', () => {
    mainWindow = undefined;
    // hidden capture windows may still be open, so 'window-all-closed' would not fire: closing the UI quits
    app.quit();
  });
}
