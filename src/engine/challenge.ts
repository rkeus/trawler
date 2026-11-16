import { FetchError, type ChallengeSolver, type Fetcher } from './types';

const CHALLENGE_TITLE = /<title>\s*(Just a moment|Attention Required|Checking your browser|DDoS-Guard)/i;
const CHALLENGE_MARKERS = /cf-browser-verification|challenge-platform|_cf_chl_opt|cf_chl_/i;

/** Detects bot-protection interstitials (Cloudflare and similar) served instead of real content. */
export function isBotChallenge(status: number, headers: Record<string, string>, bodyStart: string): boolean {
  if ((headers['cf-mitigated'] ?? '').toLowerCase() === 'challenge') return true;
  if (status !== 403 && status !== 429 && status !== 503) return false;
  return CHALLENGE_TITLE.test(bodyStart) || CHALLENGE_MARKERS.test(bodyStart);
}

const MAX_SOLVES = 3;

/**
 * Wraps a fetcher: when a request hits a bot-protection challenge, asks the solver (a real browser in the
 * same session) to pass it, then retries once. Concurrent challenged requests share one solve. After a
 * failed solve, or MAX_SOLVES solves, challenges are rethrown as they are.
 */
export function withChallengeSolver(inner: Fetcher, solver: ChallengeSolver, signal: AbortSignal): Fetcher {
  let solving: Promise<boolean> | undefined;
  let solves = 0;
  let gaveUp = false;
  return {
    async fetch(url: string) {
      try {
        return await inner.fetch(url);
      } catch (err) {
        if (!(err instanceof FetchError) || err.reason !== 'challenge' || gaveUp) throw err;
        if (!solving) {
          if (solves >= MAX_SOLVES) {
            gaveUp = true;
            throw err;
          }
          solves++;
          solving = solver
            .solve(url, signal)
            .catch(() => false)
            .finally(() => {
              solving = undefined;
            });
        }
        const solved = await solving;
        if (!solved) {
          gaveUp = true;
          throw err;
        }
        return inner.fetch(url);
      }
    },
  };
}
