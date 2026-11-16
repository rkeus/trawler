export interface SrcsetCandidate {
  url: string;
  descriptor: string;
}

const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);

/** Simplified HTML srcset parser: URL runs to the next whitespace; a trailing comma ends the candidate. */
export function parseSrcset(value: string): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = [];
  const n = value.length;
  let i = 0;
  while (i < n) {
    while (i < n && (isSpace(value[i]) || value[i] === ',')) i++;
    if (i >= n) break;
    let start = i;
    while (i < n && !isSpace(value[i])) i++;
    let url = value.slice(start, i);
    let endedWithComma = false;
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
      endedWithComma = true;
    }
    let descriptor = '';
    if (!endedWithComma) {
      start = i;
      while (i < n && value[i] !== ',') i++;
      descriptor = value.slice(start, i).trim();
    }
    if (url) out.push({ url, descriptor });
  }
  return out;
}

export function stringifySrcset(candidates: SrcsetCandidate[]): string {
  return candidates.map((c) => (c.descriptor ? `${c.url} ${c.descriptor}` : c.url)).join(', ');
}
