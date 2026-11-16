import { describe, it, expect } from 'vitest';
import { walkCss, unescapeCss } from '../../../../src/core/css/walk-css';
import { extractCssRefs } from '../../../../src/core/css/extract';

const CSS_URL = 'https://x.com/html/assets/css/style.css';
const urls = (css: string) => extractCssRefs(css, CSS_URL).map((r) => r.url);

describe('walkCss', () => {
  it('returns the input unchanged when the visitor changes nothing', () => {
    const css = 'a  { color : red ;  background: url( x.png ) }\n/* c */\n';
    expect(walkCss(css, () => undefined)).toBe(css);
  });

  it('rewrites url() values', () => {
    const out = walkCss('a{background:url(x.png)}', (raw) => (raw === 'x.png' ? 'y.png' : undefined));
    expect(out).toContain('url("y.png")');
    expect(out).not.toContain('x.png');
  });

  it('rewrites @import strings', () => {
    const out = walkCss('@import "a.css";\nb{color:red}', () => 'b.css');
    expect(out).toContain('@import "b.css"');
  });

  it('reports the source kind', () => {
    const seen: string[] = [];
    walkCss('@import url(a.css); b{background:url(c.png)}', (raw, source) => {
      seen.push(`${source}:${raw}`);
      return undefined;
    });
    expect(seen).toEqual(['css-import:a.css', 'css-url:c.png']);
  });

  it('escapes quotes and backslashes in rewritten strings', () => {
    expect(walkCss('a{background:url(x.png)}', () => 'c"d.png')).toContain(String.raw`url("c\"d.png")`);
    expect(walkCss(`@import 'a.css';`, () => "it's.css")).toContain(`@import "it's.css"`);
  });

  it('passes unescaped values to the visitor', () => {
    const seen: string[] = [];
    walkCss(String.raw`a{background:url(foo\(1\).png)} b{background:url("x\"y.png")}`, (raw) => {
      seen.push(raw);
      return undefined;
    });
    expect(seen).toEqual(['foo(1).png', 'x"y.png']);
  });
});

describe('extractCssRefs', () => {
  it('finds url() in all quoting styles', () => {
    expect(urls('a{background:url(../img/bg.png)} b{background:url("x.jpg")} c{background:url(\'y.gif\')}')).toEqual([
      'https://x.com/html/assets/img/bg.png',
      'https://x.com/html/assets/css/x.jpg',
      'https://x.com/html/assets/css/y.gif',
    ]);
  });

  it('finds @import with string and url()', () => {
    const refs = extractCssRefs('@import "base.css";\n@import url(theme.css) screen;', CSS_URL);
    expect(refs.map((r) => [r.url, r.kind, r.source])).toEqual([
      ['https://x.com/html/assets/css/base.css', 'css', 'css-import'],
      ['https://x.com/html/assets/css/theme.css', 'css', 'css-import'],
    ]);
  });

  it('finds @font-face sources, keeping query and dropping fragment', () => {
    const refs = extractCssRefs(
      "@font-face{font-family:fa;src:url(../fonts/fa.woff2?v=6#iefix) format('woff2'),url(../fonts/fa.ttf) format('truetype')}",
      CSS_URL,
    );
    expect(refs.map((r) => [r.url, r.kind])).toEqual([
      ['https://x.com/html/assets/fonts/fa.woff2?v=6', 'font'],
      ['https://x.com/html/assets/fonts/fa.ttf', 'font'],
    ]);
  });

  it('finds image-set candidates', () => {
    expect(urls('a{background-image:image-set("a.png" 1x, url(b.png) 2x)}')).toEqual([
      'https://x.com/html/assets/css/a.png',
      'https://x.com/html/assets/css/b.png',
    ]);
  });

  it('skips data URIs and fragment-only refs, and dedupes', () => {
    expect(urls('a{background:url(data:image/png;base64,AAA)} b{fill:url(#grad)} c{background:url(x.png)} d{background:url(x.png)}')).toEqual([
      'https://x.com/html/assets/css/x.png',
    ]);
  });

  it('survives broken CSS', () => {
    expect(urls('a{background:url(x.png)')).toEqual(['https://x.com/html/assets/css/x.png']);
  });

  it('decodes CSS escapes before resolving', () => {
    expect(urls(String.raw`a{background:url(foo\(1\).png)}`)).toEqual(['https://x.com/html/assets/css/foo(1).png']);
    expect(urls(String.raw`a{background:url("x\"y.png")}`)).toEqual(['https://x.com/html/assets/css/x%22y.png']);
  });
});

describe('unescapeCss', () => {
  it('decodes hex, character and newline escapes', () => {
    expect(unescapeCss(String.raw`\41 b`)).toBe('Ab');
    expect(unescapeCss(String.raw`\28`)).toBe('(');
    expect(unescapeCss(String.raw`a\.b`)).toBe('a.b');
    expect(unescapeCss('a\\\nb')).toBe('ab');
    expect(unescapeCss('plain')).toBe('plain');
  });
});
