import path from 'node:path';
import { app, dialog, session, shell, type BrowserWindow, type OpenDialogOptions } from 'electron';
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
import { createMainWindow, RENDERER_DIR } from './window';

/**
 * Starts the desktop app: stores in userData, the job and preview managers, IPC, and the window.
 * TRAWLER_USER_DATA overrides the profile folder (tests, portable use).
 */
export async function startDesktopApp(): Promise<void> {
  const override = process.env.TRAWLER_USER_DATA;
  if (override) app.setPath('userData', path.resolve(override));
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  let mainWindow: BrowserWindow | undefined;
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => app.quit());

  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const userData = app.getPath('userData');
  const settings = new SettingsStore(SettingsStore.fileIn(userData));
  const history = new HistoryStore(HistoryStore.fileIn(userData));
  const appState = new AppStateStore(AppStateStore.fileIn(userData));
  await Promise.all([settings.load(), history.load(), appState.load()]);

  const sessions = new AppSessions();
  const send = (channel: string, payload: unknown): void => sendTo(mainWindow?.webContents, channel, payload);
  const jobs = new JobManager({
    settings: () => settings.get(),
    createPorts: async (s) => {
      await sessions.reset(s.userAgent);
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
      info: { version: TRAWLER_VERSION, userDataDir: userData },
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
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    const timedOut = Symbol('timed out');
    void Promise.race([
      Promise.allSettled([jobs.shutdown(), preview.stop()]),
      sleep(settings.get().shutdownTimeoutMs).then(() => timedOut),
    ]).then((outcome) => {
      if (outcome === timedOut) {
        process.stderr.write('shutdown timed out; exiting\n');
        app.exit(0);
      } else {
        app.quit();
      }
    });
  });

  mainWindow = createMainWindow();
  mainWindow.on('closed', () => {
    mainWindow = undefined;
    // hidden capture windows may still be open, so 'window-all-closed' would not fire: closing the UI quits
    app.quit();
  });
}
