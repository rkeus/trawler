import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
    backgroundColor: '#0b0e14',
    // custom title bar: the UI draws it (src/renderer/shell/TitleBar.tsx); Windows keeps its own buttons on top
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: 'rgba(0,0,0,0)', symbolColor: '#8993a8', height: 34 },
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
  // loadURL with a properly encoded file URL: loadFile fails for folders whose names contain "%"
  win.loadURL(pathToFileURL(path.join(RENDERER_DIR, 'index.html')).href).catch((err: unknown) => {
    process.stderr.write(`could not load the UI: ${err instanceof Error ? err.message : String(err)}\n`);
  });
  return win;
}
