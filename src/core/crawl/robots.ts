export interface RobotsRules {
  /** `pathAndQuery` starts with "/" */
  isAllowed(pathAndQuery: string): boolean;
}

export const ALLOW_ALL: RobotsRules = { isAllowed: () => true };

interface Rule {
  allow: boolean;
  /** normalized pattern, used for longest-match ordering */
  pattern: string;
  matches: (path: string) => boolean;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

/** Percent-encodes non-ASCII characters and uppercases %xx escapes (RFC 9309 §2.2.2). */
function normalizePct(s: string): string {
  let out = '';
  for (const ch of s) out += ch.codePointAt(0)! > 0x7e ? encodeURIComponent(ch) : ch;
  return out.replace(/%[0-9a-fA-F]{2}/g, (m) => m.toUpperCase());
}

/**
 * Compiles a robots pattern ("*" wildcard, trailing "$" anchor) into a linear-time matcher.
 * Greedy leftmost matching of the literal parts is exact for "*"-only globs and cannot backtrack.
 */
function compilePattern(pattern: string): (path: string) => boolean {
  const anchored = pattern.endsWith('$');
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  const first = parts[0]!;
  return (p: string): boolean => {
    if (!p.startsWith(first)) return false;
    if (parts.length === 1) return anchored ? p.length === first.length : true;
    let pos = first.length;
    for (let i = 1; i < parts.length - 1; i++) {
      const idx = p.indexOf(parts[i]!, pos);
      if (idx < 0) return false;
      pos = idx + parts[i]!.length;
    }
    const last = parts[parts.length - 1]!;
    if (anchored) return p.length - last.length >= pos && p.endsWith(last);
    return p.indexOf(last, pos) >= 0;
  };
}

/** Parses robots.txt and returns the rules that apply to `agent` (default product token "trawler"). */
export function parseRobots(text: string, agent = 'trawler'): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (!current || value === '') continue;
      const pattern = normalizePct(value);
      current.rules.push({ allow: field === 'allow', pattern, matches: compilePattern(pattern) });
    } else {
      lastWasAgent = false;
    }
  }

  const token = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a === token));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);
  if (rules.length === 0) return ALLOW_ALL;

  return {
    isAllowed(pathAndQuery: string): boolean {
      const p = normalizePct(pathAndQuery);
      let best: Rule | undefined;
      for (const r of rules) {
        if (!r.matches(p)) continue;
        if (
          !best ||
          r.pattern.length > best.pattern.length ||
          (r.pattern.length === best.pattern.length && r.allow)
        ) {
          best = r;
        }
      }
      return best ? best.allow : true;
    },
  };
}
