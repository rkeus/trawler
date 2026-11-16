import { describe, it, expect } from 'vitest';
import { parseRobots, ALLOW_ALL } from '../../../../src/core/crawl/robots';

describe('parseRobots', () => {
  it('applies Disallow for *', () => {
    const r = parseRobots('User-agent: *\nDisallow: /admin/');
    expect(r.isAllowed('/admin/x')).toBe(false);
    expect(r.isAllowed('/html/a')).toBe(true);
  });

  it('lets the longest matching rule win; Allow wins ties', () => {
    const r = parseRobots('User-agent: *\nDisallow: /html/\nAllow: /html/public/');
    expect(r.isAllowed('/html/public/a')).toBe(true);
    expect(r.isAllowed('/html/x')).toBe(false);
    const tie = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a');
    expect(tie.isAllowed('/a')).toBe(true);
  });

  it('supports * and $ wildcards', () => {
    const r = parseRobots('User-agent: *\nDisallow: /*.pdf$');
    expect(r.isAllowed('/a/b.pdf')).toBe(false);
    expect(r.isAllowed('/a/b.pdf?x=1')).toBe(true);
  });

  it('prefers a group naming the agent over *', () => {
    const txt = 'User-agent: trawler\nDisallow: /\n\nUser-agent: *\nDisallow:';
    expect(parseRobots(txt).isAllowed('/x')).toBe(false);
    expect(parseRobots(txt, 'otherbot').isAllowed('/x')).toBe(true);
  });

  it('handles multiple agents per group, comments and empty files', () => {
    const r = parseRobots('# hi\nUser-agent: a\nUser-agent: trawler # me\nDisallow: /p # private\nSitemap: https://x.com/s.xml');
    expect(r.isAllowed('/p/1')).toBe(false);
    expect(parseRobots('').isAllowed('/anything')).toBe(true);
    expect(ALLOW_ALL.isAllowed('/x')).toBe(true);
  });
});
