import { FetchError, type ChallengeSolver, type Fetcher } from './types';

const CHALLENGE_TITLE = /<title>\s*(Just a moment|Attention Required|Checking your browser|DDoS-Guard)/i;
const CHALLENGE_MARKERS = /cf-browser-verification|challenge-platform|_cf_chl_opt|cf_chl_/i;

/** True when page text (title + start of the HTML) is a bot-protection interstitial. */
export function looksLikeChallengePage(text: string): boolean {
  return CHALLENGE_TITLE.test(text) || CHALLENGE_MARKERS.test(text);
}

const INTERSTITIAL_MARKERS = /cf-browser-verification|_cf_chl_opt|cf_chl_/i;

/**
 * Stricter than looksLikeChallengePage: ignores "challenge-platform", which Cloudflare also injects into
 * normal pages. Used to decide whether a challenge in the browser has been passed.
 */
export function isChallengeInterstitial(text: string): boolean {
  return CHALLENGE_TITLE.test(text) || INTERSTITIAL_MARKERS.test(text);
}

/** Detects bot-protection interstitials (Cloudflare and similar) served instead of real content. */
export function isBotChallenge(status: number, headers: Record<string, string>, bodyStart: string): boolean {
  if ((headers['cf-mitigated'] ?? '').toLowerCase() === 'challenge') return true;
  // 429 is a rate limit (Cloudflare serves its "Attention Required" page for it too): no browser can pass it, only slowing down helps
  if (status !== 403 && status !== 503) return false;
  return looksLikeChallengePage(bodyStart);
}

const MAX_SOLVES = 3;

/**
 * Wraps a fetcher: when a request hits a bot-protection challenge, asks the solver (a real browser in the
 * same session) to pass it, then retries once.
 * - Concurrent challenged requests share one solve.
 * - A request that started before a successful solve just retries; it does not trigger another solve.
 * - After a failed solve, or MAX_SOLVES solves, challenges are rethrown as they are.
 * - Cancellation during a solve is reported as an aborted FetchError.
 */
export function withChallengeSolver(inner: Fetcher, solver: ChallengeSolver, signal: AbortSignal): Fetcher {
  let solving: Promise<boolean> | undefined;
  let solves = 0;
  /** increments after each successful solve */
  let generation = 0;
  let gaveUp = false;
  const aborted = (url: string): FetchError => new FetchError('Cancelled', url, 'aborted');

  return {
    async fetch(url: string) {
      const startedIn = generation;
      try {
        return await inner.fetch(url);
      } catch (err) {
        if (!(err instanceof FetchError) || err.reason !== 'challenge') throw err;
        if (signal.aborted) throw aborted(url);
        if (generation !== startedIn) return inner.fetch(url); // solved meanwhile: the cookies are there now
        if (gaveUp) throw err;
        if (!solving) {
          if (solves >= MAX_SOLVES) {
            gaveUp = true;
            throw err;
          }
          solves++;
          solving = solver
            .solve(url, signal)
            .then((ok) => {
              if (ok) generation++;
              return ok;
            })
            .catch(() => false)
            .finally(() => {
              solving = undefined;
            });
        }
        const solved = await solving;
        if (signal.aborted) throw aborted(url);
        if (!solved) {
          gaveUp = true;
          throw err;
        }
        return inner.fetch(url);
      }
    },
  };
}
