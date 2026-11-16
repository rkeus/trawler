/**
 * Removes the "Electron/x" and app-name tokens Electron adds to Chromium's user agent (spec §6: the default is
 * Chromium's own). Those tokens raise bot-protection scores.
 */
export function cleanUserAgent(ua: string): string {
  return ua
    .replace(/\s+Electron\/\S+/gi, '')
    .replace(/\s+Trawler\/\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
