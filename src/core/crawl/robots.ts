export interface RobotsRules {
  /** `pathAndQuery` starts with "/" */
  isAllowed(pathAndQuery: string): boolean;
}

export const ALLOW_ALL: RobotsRules = { isAllowed: () => true };

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
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
      current.rules.push({ allow: field === 'allow', pattern: value, regex: toRegex(value) });
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
      let best: Rule | undefined;
      for (const r of rules) {
        if (!r.regex.test(pathAndQuery)) continue;
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
