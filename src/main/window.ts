import path from 'node:path';
import { BrowserWindow } from 'electron';

/** Built files, relative to the bundled main script (out/main/index.cjs). */
export const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
export const PRELOAD_FILE = path.join(__dirname, '..', 'preload', 'index.cjs');

/** The app window: sandboxed, isolated, no Node, no popups, no navigation away from the UI (spec section 8). */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: 'Trawler',
    show: false,
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  void win.loadFile(path.join(RENDERER_DIR, 'index.html'));
  return win;
}
