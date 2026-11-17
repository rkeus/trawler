import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { IPC } from '../shared/ipc';
import { invokeHandler, type Handlers } from './ipc-handlers';

/** `trusted` decides whether a call comes from Trawler's own UI page (spec section 8). */
export function registerIpc(handlers: Handlers, trusted: (event: IpcMainInvokeEvent) => boolean): void {
  for (const [name, channel] of Object.entries(IPC)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!trusted(event)) return { ok: false, error: 'Untrusted sender', code: 'untrusted' };
      return invokeHandler(handlers, name, args);
    });
  }
}

export function sendTo(target: WebContents | undefined, channel: string, payload: unknown): void {
  if (target && !target.isDestroyed()) target.send(channel, payload);
}
