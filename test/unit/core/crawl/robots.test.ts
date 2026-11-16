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
  it('matches pathological wildcard patterns in linear time', () => {
    const r = parseRobots('User-agent: *\nDisallow: /' + '*a'.repeat(12) + '*b');
    const t0 = performance.now();
    expect(r.isAllowed('/' + 'a'.repeat(40))).toBe(true);
    expect(r.isAllowed('/' + 'a'.repeat(40) + 'b')).toBe(false);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it('normalizes percent-encoding and non-ASCII characters', () => {
    expect(parseRobots('User-agent: *\nDisallow: /café/').isAllowed('/caf%C3%A9/x')).toBe(false);
    expect(parseRobots('User-agent: *\nDisallow: /a%3cb').isAllowed('/a%3Cb')).toBe(false);
  });

  it('handles $ with wildcards and exact anchors', () => {
    const r = parseRobots('User-agent: *\nDisallow: /exact$\nDisallow: /a*z$');
    expect(r.isAllowed('/exact')).toBe(false);
    expect(r.isAllowed('/exactly')).toBe(true);
    expect(r.isAllowed('/abcz')).toBe(false);
    expect(r.isAllowed('/abczq')).toBe(true);
  });
});
