import { pathToFileURL } from 'node:url';
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { IPC } from '../shared/ipc';
import { invokeHandler, type Handlers } from './ipc-handlers';
import { RENDERER_DIR } from './window';

const UI_PREFIX = `${pathToFileURL(RENDERER_DIR).href}/`.toLowerCase();

/** Only Trawler's own UI page may use the API (spec section 8). */
function fromOwnUi(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url.toLowerCase().startsWith(UI_PREFIX);
}

export function registerIpc(handlers: Handlers): void {
  for (const [name, channel] of Object.entries(IPC)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!fromOwnUi(event)) return { ok: false, error: 'Untrusted sender' };
      return invokeHandler(handlers, name, args);
    });
  }
}

export function sendTo(target: WebContents | undefined, channel: string, payload: unknown): void {
  if (target && !target.isDestroyed()) target.send(channel, payload);
}
