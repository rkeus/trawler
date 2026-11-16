const CHALLENGE_TITLE = /<title>\s*(Just a moment|Attention Required|Checking your browser|DDoS-Guard)/i;
const CHALLENGE_MARKERS = /cf-browser-verification|challenge-platform|_cf_chl_opt|cf_chl_/i;

/** Detects bot-protection interstitials (Cloudflare and similar) served instead of real content. */
export function isBotChallenge(status: number, headers: Record<string, string>, bodyStart: string): boolean {
  if ((headers['cf-mitigated'] ?? '').toLowerCase() === 'challenge') return true;
  if (status !== 403 && status !== 429 && status !== 503) return false;
  return CHALLENGE_TITLE.test(bodyStart) || CHALLENGE_MARKERS.test(bodyStart);
}
