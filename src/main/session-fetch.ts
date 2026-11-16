import { net, type Session } from 'electron';
import type { FetchImpl } from '../engine';

const MAX_REDIRECTS = 20;
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/** Header values must be byte strings; raw UTF-8 bytes (common in Content-Disposition) are kept byte-for-byte. */
function toByteString(value: string): string {
  return /^[\x00-\xff]*$/.test(value) ? value : Buffer.from(value, 'utf8').toString('latin1');
}

/**
 * fetch-compatible adapter over Electron's net.request in the job session (its cookies, cache and user agent).
 * It follows redirects itself, because session.fetch reports neither the final URL nor that a redirect
 * happened, and the crawl needs both (scope, aliases). Never throws from an event handler: every failure
 * rejects the promise or errors the body stream.
 */
export function createSessionFetch(ses: Session): FetchImpl {
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal ?? undefined;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      let finalUrl = url;
      let hops = 0;
      let settled = false;
      /** set once the body stream exists, so an abort can error it */
      let failStream: ((reason: unknown) => void) | undefined;
      const request = net.request({ url, method: init.method ?? 'GET', session: ses, useSessionCookies: true, redirect: 'manual' });
      for (const [name, value] of new Headers(init.headers ?? {}).entries()) request.setHeader(name, value);

      const fail = (err: unknown): void => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      const onAbort = (): void => {
        request.abort();
        failStream?.(signal!.reason);
        fail(signal!.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      request.on('redirect', (_status, _method, redirectUrl) => {
        try {
          if (++hops > MAX_REDIRECTS) {
            request.abort();
            fail(new Error(`Too many redirects (${MAX_REDIRECTS})`));
            return;
          }
          finalUrl = new URL(redirectUrl, finalUrl).href;
          request.followRedirect();
        } catch (err) {
          request.abort();
          fail(err);
        }
      });

      request.on('response', (response) => {
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            for (const v of Array.isArray(value) ? value : [value]) {
              try {
                headers.append(name, toByteString(v));
              } catch {
                // a header that still is not valid is dropped rather than failing the request
              }
            }
          }
          const body = NULL_BODY_STATUS.has(response.statusCode)
            ? null
            : new ReadableStream<Uint8Array>({
                start(controller) {
                  let done = false;
                  const finish = (fn: () => void): void => {
                    if (done) return;
                    done = true;
                    signal?.removeEventListener('abort', onAbort);
                    try {
                      fn();
                    } catch {
                      // stream already closed
                    }
                  };
                  failStream = (reason) => finish(() => controller.error(reason));
                  response.on('data', (chunk: Buffer) => {
                    if (!done) controller.enqueue(new Uint8Array(chunk));
                  });
                  response.on('end', () => finish(() => controller.close()));
                  response.on('error', (err: Error) => finish(() => controller.error(err)));
                  response.on('aborted', () => finish(() => controller.error(new Error('Response aborted'))));
                },
                cancel() {
                  request.abort();
                },
              });
          const res = new Response(body, { status: response.statusCode, statusText: response.statusMessage, headers });
          Object.defineProperty(res, 'url', { value: finalUrl }); // Response.url is read-only otherwise
          settled = true;
          resolve(res);
        } catch (err) {
          request.abort();
          fail(err);
        }
      });

      request.on('error', fail);
      request.end();
    });
}
