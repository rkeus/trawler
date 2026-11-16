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

/** Runs before page scripts: dialogs would block a hidden window forever. */
const NO_DIALOGS = 'window.alert = () => {}; window.confirm = () => true; window.prompt = () => null;';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Resolves with the promise's value, or with undefined once the deadline passes. */
function beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T | undefined> {
  return Promise.race([promise, wait(Math.max(0, deadline - Date.now())).then(() => undefined)]);
}

const isHtmlType = (contentType: string | undefined): boolean => !contentType || /html/i.test(contentType);

async function waitForNetworkIdle(rec: NetworkRecorder, idleMs: number, deadline: number, signal: AbortSignal): Promise<void> {
  while (Date.now() < deadline && !signal.aborted) {
    if (rec.idleFor() >= idleMs) return;
    await wait(POLL_MS);
  }
}

/** Resolves 'file' as soon as the main document turns out not to be HTML (a download link). */
async function waitForFileDocument(rec: NetworkRecorder, deadline: number, signal: AbortSignal): Promise<'file' | undefined> {
  while (Date.now() < deadline && !signal.aborted) {
    const doc = rec.documentResponse;
    if (doc && !isHtmlType(doc.contentType)) return 'file';
    await wait(POLL_MS);
  }
  return undefined;
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
    // stay on the page's own site (the requested origin, or the one it redirected to)
    wc.on('will-navigate', (event) => {
      const target = new URL(event.url).origin;
      let current = origin;
      try {
        current = new URL(wc.getURL()).origin;
      } catch {
        // no URL yet
      }
      if (target !== origin && target !== current) event.preventDefault();
    });

    // CDP commands on a fresh window wait for the first committed navigation: commit about:blank first
    const ready = await beforeDeadline(
      (async () => {
        await wc.loadURL('about:blank');
        wc.debugger.attach('1.3');
        wc.debugger.on('message', (_event, method, params) => {
          if (method === 'Page.javascriptDialogOpening') {
            void wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: true }).catch(() => undefined);
            return;
          }
          recorder.handle(method, params);
        });
        await wc.debugger.sendCommand('Network.enable', {
          maxTotalBufferSize: 256 * MB,
          maxResourceBufferSize: Math.min(Math.max(opts.maxBodyBytes * 2, MB), 128 * MB),
        });
        await wc.debugger.sendCommand('Page.enable');
        await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: NO_DIALOGS });
        return true;
      })(),
      deadline,
    );
    if (o.signal.aborted) throw aborted();
    if (ready === undefined) throw new FetchError(`Timed out preparing the browser after ${o.timeoutMs} ms`, url, 'timeout');

    let loadError: unknown;
    const navigation = wc.loadURL(url).then(
      () => 'loaded' as const,
      (err: unknown) => {
        loadError = err; // e.g. a download link: the navigation becomes a (blocked) download
        return 'failed' as const;
      },
    );
    const outcome = await beforeDeadline(Promise.race([navigation, waitForFileDocument(recorder, deadline, o.signal)]), deadline);
    if (o.signal.aborted) throw aborted();
    if ((outcome === undefined || outcome === 'file') && !win.isDestroyed()) wc.stop(); // timeout, or a file: stop loading

    if (outcome === 'loaded') {
      if (o.autoScroll) await beforeDeadline(wc.executeJavaScript(SCROLL_SCRIPT, true).catch(() => undefined), deadline);
      await waitForNetworkIdle(recorder, o.networkIdleMs, deadline, o.signal);
    }
    if (o.signal.aborted) throw aborted();
    await beforeDeadline(recorder.settle(), Date.now() + 5000); // body reads must not hang the capture
    if (o.signal.aborted) throw aborted();

    const doc = recorder.document ?? (recorder.documentResponse ? { ...recorder.documentResponse, html: '' } : undefined);
    if (!doc) {
      if (outcome === undefined) throw new FetchError(`Timed out after ${o.timeoutMs} ms`, url, 'timeout');
      const reason = loadError instanceof Error ? loadError.message : 'no document response';
      throw new FetchError(`Could not load the page: ${reason}`, url, 'network');
    }
    let renderedHtml = '';
    if (isHtmlType(doc.contentType) && !win.isDestroyed()) {
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
