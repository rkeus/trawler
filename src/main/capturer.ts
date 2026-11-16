import { BrowserWindow, type Session } from 'electron';
import { FetchError, type CaptureOptions, type CaptureResult, type Capturer } from '../engine';
import { NetworkRecorder } from './network-recorder';

export interface CapturerOptions {
  /** bodies above this are left out (settings.memoryBodyLimitBytes) */
  maxBodyBytes: number;
  /** false: do not read resource bodies (verification) */
  collectBodies?: boolean;
}

const POLL_MS = 100;
const MB = 1024 * 1024;

/** Scrolls to the bottom in steps so lazy content loads, then back to the top. */
const SCROLL_SCRIPT = `(async () => {
  const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
  for (let i = 0, y = 0; i < 60; i++) {
    y += step;
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
    if (y >= document.documentElement.scrollHeight) break;
  }
  window.scrollTo(0, 0);
})()`;

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Resolves with the promise's value, or with undefined once the deadline passes. */
function beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T | undefined> {
  return Promise.race([promise, wait(Math.max(0, deadline - Date.now())).then(() => undefined)]);
}

async function waitForNetworkIdle(rec: NetworkRecorder, idleMs: number, deadline: number, signal: AbortSignal): Promise<void> {
  while (Date.now() < deadline && !signal.aborted) {
    if (rec.idleFor() >= idleMs) return;
    await wait(POLL_MS);
  }
}

/**
 * Renders pages in a hidden window of the job's session, recording every response through the
 * DevTools protocol (spec §4.3). One window per capture; it is destroyed afterwards or on abort.
 */
export function createCapturer(ses: Session, opts: CapturerOptions): Capturer {
  return { capture: (url, o) => captureOnce(ses, url, o, opts) };
}

async function captureOnce(ses: Session, url: string, o: CaptureOptions, opts: CapturerOptions): Promise<CaptureResult> {
  const aborted = (): FetchError => new FetchError('Cancelled', url, 'aborted');
  if (o.signal.aborted) throw aborted();
  const deadline = Date.now() + o.timeoutMs;
  const origin = new URL(url).origin;

  const win = new BrowserWindow({
    show: false,
    width: 1366,
    height: 900,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const wc = win.webContents;
  const onAbort = (): void => {
    if (!win.isDestroyed()) win.destroy();
  };
  o.signal.addEventListener('abort', onAbort, { once: true });

  const recorder = new NetworkRecorder({
    maxBodyBytes: opts.maxBodyBytes,
    collectBodies: opts.collectBodies ?? true,
    getBody: (requestId) => wc.debugger.sendCommand('Network.getResponseBody', { requestId }),
  });

  try {
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    // stay on the page's own site: scripted navigations elsewhere are blocked
    wc.on('will-navigate', (event) => {
      if (new URL(event.url).origin !== origin) event.preventDefault();
    });
    // Network.enable never answers on a webContents that has not navigated yet (Electron 45): commit about:blank first
    await wc.loadURL('about:blank');
    wc.debugger.attach('1.3');
    wc.debugger.on('message', (_event, method, params) => recorder.handle(method, params));
    await wc.debugger.sendCommand('Network.enable', {
      maxTotalBufferSize: 256 * MB,
      maxResourceBufferSize: Math.min(Math.max(opts.maxBodyBytes * 2, MB), 128 * MB),
    });

    let loadError: unknown;
    const loaded = await beforeDeadline(
      wc.loadURL(url).then(
        () => true,
        (err: unknown) => {
          loadError = err; // e.g. a PDF: the navigation turns into a (blocked) download
          return true;
        },
      ),
      deadline,
    );
    if (o.signal.aborted) throw aborted();
    if (loaded === undefined && !win.isDestroyed()) wc.stop(); // render timeout: keep what arrived

    if (!loadError) {
      if (o.autoScroll) await beforeDeadline(wc.executeJavaScript(SCROLL_SCRIPT, true).catch(() => undefined), deadline);
      await waitForNetworkIdle(recorder, o.networkIdleMs, deadline, o.signal);
    }
    if (o.signal.aborted) throw aborted();
    await beforeDeadline(recorder.settle(), Date.now() + 5000); // body reads must not hang the capture

    const doc = recorder.document;
    if (!doc) {
      if (loaded === undefined) throw new FetchError(`Timed out after ${o.timeoutMs} ms`, url, 'timeout');
      const reason = loadError instanceof Error ? loadError.message : 'no document response';
      throw new FetchError(`Could not load the page: ${reason}`, url, 'network');
    }
    const isHtml = !doc.contentType || /html/i.test(doc.contentType);
    let renderedHtml = '';
    if (isHtml && !win.isDestroyed()) {
      const outer = await beforeDeadline(
        wc.executeJavaScript('document.documentElement.outerHTML').catch(() => ''),
        Date.now() + 5000,
      );
      renderedHtml = typeof outer === 'string' ? outer : '';
    }
    return {
      url,
      finalUrl: doc.url,
      status: doc.status,
      ...(doc.contentType ? { contentType: doc.contentType } : {}),
      html: doc.html,
      renderedHtml,
      resources: recorder.resources,
      dataRequests: recorder.dataRequests,
      failed: recorder.failed,
    };
  } catch (err) {
    if (o.signal.aborted) throw aborted();
    if (err instanceof FetchError) throw err;
    throw new FetchError(`Rendering failed: ${err instanceof Error ? err.message : String(err)}`, url, 'network');
  } finally {
    o.signal.removeEventListener('abort', onAbort);
    if (!win.isDestroyed()) {
      try {
        wc.debugger.detach();
      } catch {
        // already detached
      }
      win.destroy();
    }
  }
}
