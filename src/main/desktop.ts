import path from 'node:path';
import { app, dialog, session, shell, type BrowserWindow, type OpenDialogOptions } from 'electron';
import { TRAWLER_VERSION } from '../engine';
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
import { createMainWindow } from './window';

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
    record: (entry, s) => history.add(entry, s.historySize),
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
  );

  // quitting cancels a running job (partial manifest written) and stops the preview first
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void Promise.allSettled([jobs.shutdown(), preview.stop()]).finally(() => app.quit());
  });

  mainWindow = createMainWindow();
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}
