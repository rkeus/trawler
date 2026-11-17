// Sandboxed preload: bundled into one file that only requires "electron" (scripts/build-main.mjs).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  IPC_EVENTS,
  type IpcReply,
  type JobEventMessage,
  type JobFinishedMessage,
  type TrawlerBridge,
} from '../shared/ipc';

/** Commands resolve with the reply itself: the UI's api wrapper turns failures into errors with a code. */
async function invoke(channel: string, args: unknown[]): Promise<IpcReply<unknown>> {
  return (await ipcRenderer.invoke(channel, ...args)) as IpcReply<unknown>;
}

function subscribe<T>(channel: string, listener: (msg: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, msg: T): void => listener(msg);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const commands = Object.fromEntries(
  Object.entries(IPC).map(([name, channel]) => [name, (...args: unknown[]) => invoke(channel, args)]),
) as unknown as Omit<TrawlerBridge, 'onJobEvent' | 'onJobFinished'>;

const bridge: TrawlerBridge = {
  ...commands,
  onJobEvent: (listener: (msg: JobEventMessage) => void) => subscribe(IPC_EVENTS.jobEvent, listener),
  onJobFinished: (listener: (msg: JobFinishedMessage) => void) => subscribe(IPC_EVENTS.jobFinished, listener),
};

contextBridge.exposeInMainWorld('trawler', bridge);
