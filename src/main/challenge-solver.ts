import { BrowserWindow, type Session } from 'electron';
import { isChallengeInterstitial, type ChallengeSolver } from '../engine';

const POLL_MS = 500;
const PROBE = "document.title + '\\n' + document.documentElement.outerHTML.slice(0, 4096)";

/**
 * Opens a challenged URL in a hidden window of the job's session. The challenge script runs there and sets
 * its cookies in that session, which the job's requests then reuse. Solved when the main frame has navigated
 * to a successful response that is not an interstitial; gives up after `timeoutMs`.
 */
export function createChallengeSolver(ses: Session, timeoutMs: number): ChallengeSolver {
  return {
    async solve(url: string, signal: AbortSignal): Promise<boolean> {
      if (signal.aborted) return false;
      const win = new BrowserWindow({
        show: false,
        webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
      });
      const onAbort = (): void => {
        if (!win.isDestroyed()) win.destroy();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const wc = win.webContents;
        let mainStatus: number | undefined;
        wc.on('did-navigate', (_event, _url, httpResponseCode) => {
          mainStatus = httpResponseCode;
        });
        wc.setAudioMuted(true);
        wc.setWindowOpenHandler(() => ({ action: 'deny' }));
        void wc.loadURL(url).catch(() => undefined);
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline && !signal.aborted && !win.isDestroyed()) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          if (win.isDestroyed() || wc.isLoading() || mainStatus === undefined || mainStatus >= 400) continue;
          const text: unknown = await wc.executeJavaScript(PROBE).catch(() => '');
          if (typeof text === 'string' && text.length > 0 && !isChallengeInterstitial(text)) return true;
        }
        return false;
      } finally {
        signal.removeEventListener('abort', onAbort);
        if (!win.isDestroyed()) win.destroy();
      }
    },
  };
}
