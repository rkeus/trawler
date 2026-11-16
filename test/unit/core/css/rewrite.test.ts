import { describe, it, expect } from 'vitest';
import { rewriteRef } from '../../../../src/core/rewrite-ref';
import { rewriteCss } from '../../../../src/core/css/rewrite';
import type { ResolveLocal } from '../../../../src/shared/types';

const LOCAL: Record<string, string> = {
  'https://x.com/html/assets/img/bg.png': 'assets/img/bg.png',
  'https://x.com/html/assets/fonts/fa.woff2?v=6': 'assets/fonts/fa.woff2',
};
const resolve: ResolveLocal = (u) => LOCAL[u];
const CSS_URL = 'https://x.com/html/assets/css/style.css';
const CSS_LOCAL = 'assets/css/style.css';

describe('rewriteRef', () => {
  it('maps downloaded refs to relative local paths', () => {
    expect(rewriteRef('../img/bg.png', CSS_URL, CSS_LOCAL, resolve)).toBe('../img/bg.png');
    expect(rewriteRef('/html/assets/img/bg.png', 'https://x.com/html/index.html', 'index.html', resolve)).toBe(
      'assets/img/bg.png',
    );
  });
  it('drops the query and keeps the fragment', () => {
    expect(rewriteRef('../fonts/fa.woff2?v=6#iefix', CSS_URL, CSS_LOCAL, resolve)).toBe('../fonts/fa.woff2#iefix');
  });
  it('absolutizes refs that were not downloaded', () => {
    expect(rewriteRef('missing.png', CSS_URL, CSS_LOCAL, resolve)).toBe('https://x.com/html/assets/css/missing.png');
  });
  it('leaves fragment-only, empty, template and non-http refs alone', () => {
    expect(rewriteRef('#top', CSS_URL, CSS_LOCAL, resolve)).toBeUndefined();
    expect(rewriteRef('', CSS_URL, CSS_LOCAL, resolve)).toBeUndefined();
    expect(rewriteRef('{{ img }}', CSS_URL, CSS_LOCAL, resolve)).toBeUndefined();
    expect(rewriteRef('data:image/png;base64,AAA', CSS_URL, CSS_LOCAL, resolve)).toBeUndefined();
  });
});

describe('rewriteCss', () => {
  it('rewrites all refs in a stylesheet', () => {
    const css = "@font-face{src:url('../fonts/fa.woff2?v=6#iefix')}\n.a{background:url(/html/assets/img/bg.png)}";
    const out = rewriteCss(css, CSS_URL, CSS_LOCAL, resolve);
    expect(out).toContain('url("../fonts/fa.woff2#iefix")');
    expect(out).toContain('url("../img/bg.png")');
  });
  it('returns identical CSS when nothing needs to change', () => {
    const css = '.a { background: url(../img/bg.png) }';
    expect(rewriteCss(css, CSS_URL, CSS_LOCAL, resolve)).toBe(css);
  });
});
