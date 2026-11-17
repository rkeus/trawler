import { IPC, type InvokeName, type IpcErrorCode, type TrawlerApi, type TrawlerBridge } from '../shared/ipc';

/** A failed command: `code` tells the UI what kind of failure it was ("busy", "invalid", ...). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: IpcErrorCode,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Turns the preload's value-returning bridge into the API the UI uses: failed replies reject with an ApiError. */
export function createApi(bridge: TrawlerBridge): TrawlerApi {
  const commands = Object.fromEntries(
    (Object.keys(IPC) as InvokeName[]).map((name) => [
      name,
      async (...args: unknown[]) => {
        const call = bridge[name] as (...a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string; code?: IpcErrorCode }>;
        const reply = await call(...args);
        if (!reply.ok) throw new ApiError(reply.error ?? 'Unknown error', reply.code ?? 'failed');
        return reply.value;
      },
    ]),
  ) as unknown as Omit<TrawlerApi, 'onJobEvent' | 'onJobFinished'>;
  return { ...commands, onJobEvent: bridge.onJobEvent, onJobFinished: bridge.onJobFinished };
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
