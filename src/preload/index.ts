// Sandboxed preload: bundled into one file that only requires "electron" (scripts/build-main.mjs).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  IPC_EVENTS,
  type IpcReply,
  type JobEventMessage,
  type JobFinishedMessage,
  type TrawlerApi,
} from '../shared/ipc';

async function invoke(channel: string, args: unknown[]): Promise<unknown> {
  const reply = (await ipcRenderer.invoke(channel, ...args)) as IpcReply<unknown>;
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
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
) as unknown as Omit<TrawlerApi, 'onJobEvent' | 'onJobFinished'>;

const api: TrawlerApi = {
  ...commands,
  onJobEvent: (listener: (msg: JobEventMessage) => void) => subscribe(IPC_EVENTS.jobEvent, listener),
  onJobFinished: (listener: (msg: JobFinishedMessage) => void) => subscribe(IPC_EVENTS.jobFinished, listener),
};

contextBridge.exposeInMainWorld('trawler', api);
