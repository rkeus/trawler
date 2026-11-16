import { describe, it, expect } from 'vitest';
import { computeScope, inScope, isPageLike, shouldCrawl } from '../../../../src/core/crawl/scope';
import { parseRobots } from '../../../../src/core/crawl/robots';

describe('computeScope', () => {
  it('uses the seed directory as base path', () => {
    expect(computeScope('https://x.com/html/index.html')).toEqual({ origin: 'https://x.com', host: 'x.com', basePath: '/html/' });
    expect(computeScope('https://x.com/html/')).toEqual({ origin: 'https://x.com', host: 'x.com', basePath: '/html/' });
    expect(computeScope('https://x.com')).toEqual({ origin: 'https://x.com', host: 'x.com', basePath: '/' });
    expect(computeScope('https://x.com/html')).toEqual({ origin: 'https://x.com', host: 'x.com', basePath: '/' });
  });
});

describe('inScope', () => {
  const scope = computeScope('https://x.com/html/index.html');
  it('requires same origin and base path', () => {
    expect(inScope('https://x.com/html/about.html', scope)).toBe(true);
    expect(inScope('https://x.com/html/sub/a.html', scope)).toBe(true);
    expect(inScope('https://x.com/other/a.html', scope)).toBe(false);
    expect(inScope('https://y.com/html/a.html', scope)).toBe(false);
    expect(inScope('http://x.com/html/a.html', scope)).toBe(true);
  });
});

describe('isPageLike', () => {
  it('accepts html-ish and extensionless paths', () => {
    expect(isPageLike('https://x.com/about')).toBe(true);
    expect(isPageLike('https://x.com/dir/')).toBe(true);
    expect(isPageLike('https://x.com/a.html')).toBe(true);
    expect(isPageLike('https://x.com/a.htm')).toBe(true);
    expect(isPageLike('https://x.com/a.PHP')).toBe(true);
    expect(isPageLike('https://x.com/a.shtml')).toBe(true);
    expect(isPageLike('https://x.com/a.png')).toBe(false);
    expect(isPageLike('https://x.com/a.pdf')).toBe(false);
  });
});

describe('shouldCrawl', () => {
  const scope = computeScope('https://x.com/html/index.html');
  it('applies scope, page-likeness, excludes and robots', () => {
    const filter = {
      scope,
      exclude: [/logout/],
      robots: parseRobots('User-agent: *\nDisallow: /html/private/'),
    };
    expect(shouldCrawl('https://x.com/html/about.html', filter)).toBe(true);
    expect(shouldCrawl('https://x.com/html/logout.html', filter)).toBe(false);
    expect(shouldCrawl('https://x.com/html/private/a.html', filter)).toBe(false);
    expect(shouldCrawl('https://x.com/html/a.png', filter)).toBe(false);
    expect(shouldCrawl('https://x.com/other/a.html', filter)).toBe(false);
  });
  it('works without robots rules', () => {
    expect(shouldCrawl('https://x.com/html/a.html', { scope, exclude: [] })).toBe(true);
  });
});
