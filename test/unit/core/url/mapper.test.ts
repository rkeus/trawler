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
    expect(m.map('http://x.com/html/a.js')).toBe('vendor/x.com/html/a.js');
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
});
