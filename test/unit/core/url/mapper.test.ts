import { describe, it, expect } from 'vitest';
import { UrlMapper } from '../../../../src/core/url/mapper';

const mk = () => new UrlMapper({ origin: 'https://x.com', rootPath: '/html/' });

describe('UrlMapper', () => {
  it('maps same-origin files under the root', () => {
    const m = mk();
    expect(m.map('https://x.com/html/index.html')).toBe('index.html');
    expect(m.map('https://x.com/html/assets/css/style.css', 'text/css')).toBe('assets/css/style.css');
  });

  it('maps directories and extensionless html to index.html', () => {
    const m = mk();
    expect(m.map('https://x.com/html/', 'text/html')).toBe('index.html');
    expect(m.map('https://x.com/html/about', 'text/html')).toBe('about/index.html');
  });

  it('renames server-script pages served as html', () => {
    expect(mk().map('https://x.com/html/contact.php', 'text/html; charset=utf-8')).toBe('contact.html');
  });

  it('adds an extension from content type when missing', () => {
    const m = mk();
    expect(m.map('https://x.com/html/api/data', 'application/json')).toBe('api/data.json');
    expect(m.map('https://x.com/html/img/logo')).toBe('img/logo');
  });

  it('drops the query string and suffixes colliding variants', () => {
    const m = mk();
    expect(m.map('https://x.com/html/a.css?v=2')).toBe('a.css');
    const second = m.map('https://x.com/html/a.css?v=3');
    expect(second).toMatch(/^a\.__q-[0-9a-f]{6}\.css$/);
  });

  it('is idempotent', () => {
    const m = mk();
    const a = m.map('https://x.com/html/a.css?v=3');
    expect(m.map('https://x.com/html/a.css?v=3')).toBe(a);
    expect(m.get('https://x.com/html/a.css?v=3')).toBe(a);
    expect(m.get('https://x.com/html/never.css')).toBeUndefined();
  });

  it('treats case-only differences as collisions (Windows)', () => {
    const m = mk();
    expect(m.map('https://x.com/html/A.png')).toBe('A.png');
    expect(m.map('https://x.com/html/a.png')).toMatch(/^a\.__q-[0-9a-f]{6}\.png$/);
  });

  it('puts external hosts under vendor/', () => {
    const m = mk();
    expect(m.map('https://cdn.example.com/lib/x.min.js')).toBe('vendor/cdn.example.com/lib/x.min.js');
    expect(m.map('http://localhost:8080/a.js')).toBe('vendor/localhost_8080/a.js');
  });

  it('puts same-host files outside the root under _outside/', () => {
    expect(mk().map('https://x.com/other/a.png')).toBe('_outside/other/a.png');
  });

  it('decodes and sanitizes segments', () => {
    const m = mk();
    expect(m.map('https://x.com/html/img/my%20photo.png')).toBe('img/my photo.png');
    expect(m.map('https://x.com/html/a%2Fb.png')).toBe('a_b.png');
    expect(m.map('https://x.com/html/c%3Ad.png')).toBe('c_d.png');
  });

  it('moves over-long paths to _misc/', () => {
    const seg = 'd'.repeat(60);
    const out = mk().map(`https://x.com/html/${seg}/${seg}/${seg}/${seg}/f.png`);
    expect(out).toMatch(/^_misc\/[0-9a-f]{10}\/f\.png$/);
  });

  it('resolves file-vs-directory conflicts', () => {
    const m = mk();
    expect(m.map('https://x.com/html/data')).toBe('data');
    expect(m.map('https://x.com/html/data/x.json')).toMatch(/^_misc\/[0-9a-f]{10}\/x\.json$/);

    const m2 = mk();
    expect(m2.map('https://x.com/html/data/x.json')).toBe('data/x.json');
    expect(m2.map('https://x.com/html/data')).toMatch(/^data\.__q-[0-9a-f]{6}$/);
  });

  it('lists all entries', () => {
    const m = mk();
    m.map('https://x.com/html/a.css');
    expect([...m.entries()]).toEqual([['https://x.com/html/a.css', 'a.css']]);
  });
  it('treats the same host on another scheme as the same site', () => {
    expect(mk().map('http://x.com/html/a.js')).toBe('a.js');
  });

  it('saves html with a dotted last segment as index.html in a folder', () => {
    const m = mk();
    expect(m.map('https://x.com/html/blog/release-1.2', 'text/html')).toBe('blog/release-1.2/index.html');
    expect(m.map('https://x.com/html/u/john.doe', 'text/html')).toBe('u/john.doe/index.html');
    expect(m.map('https://x.com/html/page.shtml', 'text/html')).toBe('page.html');
  });

  it('lets css/js content types override misleading extensions', () => {
    const m = mk();
    expect(m.map('https://x.com/html/wp/load-styles.php?c=1', 'text/css')).toBe('wp/load-styles.css');
    expect(m.map('https://x.com/html/js/app.min', 'application/javascript')).toBe('js/app.min.js');
    expect(m.map('https://x.com/html/js/mod.mjs', 'text/javascript')).toBe('js/mod.mjs');
    expect(m.map('https://x.com/html/img/a.png', 'image/jpeg')).toBe('img/a.png');
  });

  it('sanitizes vendor host directory names', () => {
    const m = mk();
    expect(m.map('http://[::1]:8080/a.js')).toBe('vendor/[__1]_8080/a.js');
    expect(m.map('https://nul.example.com/a.js')).toBe('vendor/nul_.example.com/a.js');
    expect(m.map('https://cdn.com./b.js')).toBe('vendor/cdn.com/b.js');
  });

  it('resolves redirect aliases', () => {
    const m = mk();
    m.map('https://x.com/html/new.html', 'text/html');
    m.alias('https://x.com/html/old.html', 'https://x.com/html/new.html');
    m.alias('https://x.com/html/older.html', 'https://x.com/html/old.html');
    expect(m.get('https://x.com/html/old.html')).toBe('new.html');
    expect(m.get('https://x.com/html/older.html')).toBe('new.html');
    expect(m.get('https://x.com/html/nope.html')).toBeUndefined();
  });

  it('maps directory URLs to local directories', () => {
    const m = mk();
    expect(m.localDir('https://x.com/html/')).toBe('');
    expect(m.localDir('https://x.com/html/sub/')).toBe('sub');
    expect(m.localDir('https://x.com/html/sub/page.html')).toBe('sub');
    expect(m.localDir('https://x.com/html/my%20dir/')).toBe('my dir');
    expect(m.localDir('https://y.com/html/')).toBeUndefined();
    expect(m.localDir('https://x.com/other/')).toBeUndefined();
  });
});
