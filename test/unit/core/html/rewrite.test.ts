import { describe, it, expect } from 'vitest';
import { rewriteHtml } from '../../../../src/core/html/rewrite';
import type { ResolveLocal } from '../../../../src/shared/types';

const LOCAL: Record<string, string> = {
  'https://x.com/html/assets/css/style.css': 'assets/css/style.css',
  'https://x.com/html/about.html': 'about.html',
  'https://x.com/html/assets/img/a.png': 'assets/img/a.png',
  'https://x.com/html/assets/img/sprite.svg': 'assets/img/sprite.svg',
  'https://x.com/html/assets/img/hero.jpg': 'assets/img/hero.jpg',
};
const resolve: ResolveLocal = (u) => LOCAL[u];
const PAGE = 'https://x.com/html/index.html';
const rw = (html: string, page = PAGE, local = 'index.html') => rewriteHtml(html, page, local, resolve);

describe('rewriteHtml', () => {
  it('rewrites root-absolute and absolute same-origin refs to relative', () => {
    expect(rw('<link rel="stylesheet" href="/html/assets/css/style.css">')).toBe(
      '<link rel="stylesheet" href="assets/css/style.css">',
    );
    expect(rw('<a href="https://x.com/html/about.html">A</a>')).toBe('<a href="about.html">A</a>');
  });

  it('computes paths relative to the page location', () => {
    expect(rw('<img src="../assets/img/a.png">', 'https://x.com/html/blog/post.html', 'blog/post.html')).toBe(
      '<img src="../assets/img/a.png">',
    );
    expect(rw('<img src="/html/assets/img/a.png">', 'https://x.com/html/blog/post.html', 'blog/post.html')).toBe(
      '<img src="../assets/img/a.png">',
    );
  });

  it('absolutizes refs that were not downloaded, encoding & in attributes', () => {
    expect(rw('<img src="missing.png">')).toBe('<img src="https://x.com/html/missing.png">');
    expect(rw('<img src="m.png?x=1&amp;y=2">')).toBe('<img src="https://x.com/html/m.png?x=1&amp;y=2">');
  });

  it('keeps fragments', () => {
    expect(rw('<svg><use href="assets/img/sprite.svg#icon"></use></svg>')).toBe(
      '<svg><use href="assets/img/sprite.svg#icon"></use></svg>',
    );
  });

  it('removes <base href>', () => {
    const out = rw('<head><base href="https://x.com/html/"></head><body><a href="about.html">A</a></body>');
    expect(out).toContain('<base');
    expect(out).not.toContain('href="https://x.com/html/"');
    expect(out).toContain('<a href="about.html">');
  });

  it('rewrites inline styles and <style> blocks', () => {
    expect(rw('<div style="background:url(/html/assets/img/hero.jpg)"></div>')).toBe(
      '<div style="background:url(&quot;assets/img/hero.jpg&quot;)"></div>',
    );
    expect(rw('<style>.h{background:url(/html/assets/img/hero.jpg)}</style>')).toBe(
      '<style>.h{background:url("assets/img/hero.jpg")}</style>',
    );
  });

  it('rewrites srcset per candidate', () => {
    expect(rw('<img srcset="/html/assets/img/a.png 1x, missing2.png 2x">')).toBe(
      '<img srcset="assets/img/a.png 1x, https://x.com/html/missing2.png 2x">',
    );
  });

  it('leaves unrelated markup untouched', () => {
    const html = '<p   class=x>hi</p><a href="#top">t</a><a href=about.html>a</a>';
    expect(rw(html)).toBe(html);
  });
});
