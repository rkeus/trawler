import { describe, it, expect } from 'vitest';
import { shortHash } from '../../../../src/core/url/hash';
import { extFromContentType, isHtmlContentType, kindFromUrl, isPageExt, SERVER_PAGE_EXTS } from '../../../../src/core/url/mime';
import { normalizeUrl } from '../../../../src/core/url/normalize';
import { splitFragment, relativeHref, relativeDirHref } from '../../../../src/core/url/href';

describe('shortHash', () => {
  it('returns the first n hex chars of sha1', () => {
    expect(shortHash('abc', 6)).toBe('a9993e');
    expect(shortHash('abc', 10)).toBe('a9993e3647');
  });
});

describe('mime', () => {
  it('maps content types to extensions', () => {
    expect(extFromContentType('text/css; charset=utf-8')).toBe('.css');
    expect(extFromContentType('image/svg+xml')).toBe('.svg');
    expect(extFromContentType('application/json')).toBe('.json');
    expect(extFromContentType('font/woff2')).toBe('.woff2');
    expect(extFromContentType('application/x-unknown')).toBeUndefined();
    expect(extFromContentType(undefined)).toBeUndefined();
  });

  it('detects html content types', () => {
    expect(isHtmlContentType('text/html; charset=UTF-8')).toBe(true);
    expect(isHtmlContentType('application/xhtml+xml')).toBe(true);
    expect(isHtmlContentType('text/css')).toBe(false);
    expect(isHtmlContentType(undefined)).toBe(false);
  });

  it('infers kind from extension', () => {
    expect(kindFromUrl('https://x.com/a.woff2')).toBe('font');
    expect(kindFromUrl('https://x.com/a.css?v=1')).toBe('css');
    expect(kindFromUrl('https://x.com/a.JPG')).toBe('image');
    expect(kindFromUrl('https://x.com/a.mp4')).toBe('media');
    expect(kindFromUrl('https://x.com/a.json')).toBe('data');
    expect(kindFromUrl('https://x.com/a.html')).toBe('page');
    expect(kindFromUrl('https://x.com/a.mjs')).toBe('js');
    expect(kindFromUrl('https://x.com/about')).toBe('other');
  });

  it('prefers content type over extension', () => {
    expect(kindFromUrl('https://x.com/data', 'application/json')).toBe('data');
    expect(kindFromUrl('https://x.com/x.php', 'text/html')).toBe('page');
    expect(kindFromUrl('https://x.com/x.png', 'application/x-unknown')).toBe('image');
  });

  it('classifies page extensions', () => {
    for (const ext of ['', '.html', '.htm', '.php', '.asp', '.aspx', '.jsp', '.cfm', '.cgi', '.shtml', '.xhtml']) {
      expect(isPageExt(ext)).toBe(true);
    }
    expect(isPageExt('.png')).toBe(false);
    expect(SERVER_PAGE_EXTS.has('.html')).toBe(false);
  });
});

describe('normalizeUrl', () => {
  const base = 'https://x.com/html/index.html';
  it('resolves relative URLs', () => {
    expect(normalizeUrl('assets/a.css', base)).toBe('https://x.com/html/assets/a.css');
    expect(normalizeUrl('../img/a.png', 'https://x.com/html/sub/p.html')).toBe('https://x.com/html/img/a.png');
    expect(normalizeUrl('//cdn.com/a.js', base)).toBe('https://cdn.com/a.js');
  });
  it('strips fragments, keeps queries', () => {
    expect(normalizeUrl('page.html#top', base)).toBe('https://x.com/html/page.html');
    expect(normalizeUrl('a.css?v=2', base)).toBe('https://x.com/html/a.css?v=2');
  });
  it('lowercases host and drops default port', () => {
    expect(normalizeUrl('HTTPS://X.COM/A')).toBe('https://x.com/A');
    expect(normalizeUrl('https://x.com:443/a')).toBe('https://x.com/a');
  });
  it('trims whitespace', () => {
    expect(normalizeUrl('  a.png \n', base)).toBe('https://x.com/html/a.png');
  });
  it('rejects non-http and invalid', () => {
    expect(normalizeUrl('mailto:a@b.c', base)).toBeNull();
    expect(normalizeUrl('javascript:void(0)', base)).toBeNull();
    expect(normalizeUrl('data:image/png;base64,AAA', base)).toBeNull();
    expect(normalizeUrl('tel:123', base)).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('href', () => {
  it('splits fragments', () => {
    expect(splitFragment('a.svg#icon')).toEqual(['a.svg', '#icon']);
    expect(splitFragment('a.svg')).toEqual(['a.svg', '']);
  });
  it('computes relative hrefs between local files', () => {
    expect(relativeHref('index.html', 'assets/css/a.css')).toBe('assets/css/a.css');
    expect(relativeHref('assets/css/a.css', 'assets/fonts/f.woff2')).toBe('../fonts/f.woff2');
    expect(relativeHref('pages/x.html', 'vendor/cdn.com/a.js')).toBe('../vendor/cdn.com/a.js');
    expect(relativeHref('a/b/c.html', 'a/b/c.html')).toBe('c.html');
  });
  it('percent-encodes path segments', () => {
    expect(relativeHref('index.html', 'img/my photo.png')).toBe('img/my%20photo.png');
  });
  it('computes relative directory hrefs', () => {
    expect(relativeDirHref('index.html', '')).toBe('./');
    expect(relativeDirHref('blog/post.html', '')).toBe('../');
    expect(relativeDirHref('index.html', 'sub dir')).toBe('sub%20dir/');
    expect(relativeDirHref('a/b.html', 'a')).toBe('./');
  });
});
