import { describe, it, expect } from 'vitest';
import { decodeBody, encodeBody, declareUtf8 } from '../../../src/engine/text';
import { contentTypeForPath } from '../../../src/engine/content-type';
import { sleep } from '../../../src/engine/sleep';

describe('decodeBody / encodeBody', () => {
  it('round-trips UTF-8 including non-ASCII and BOM', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<p>café</p>', 'utf8')]);
    const d = decodeBody(buf, 'text/html; charset=utf-8');
    expect(d.encoding).toBe('utf8');
    expect(d.text.endsWith('<p>café</p>')).toBe(true);
    expect(encodeBody(d.text, d.encoding).equals(buf)).toBe(true);
  });

  it('uses byte-exact latin1 for declared non-UTF-8 charsets', () => {
    const buf = Buffer.from([0x3c, 0x70, 0x3e, 0xe0, 0xe1, 0x3c, 0x2f, 0x70, 0x3e]);
    const d = decodeBody(buf, 'text/html; charset=windows-1251');
    expect(d.encoding).toBe('latin1');
    expect(encodeBody(d.text, d.encoding).equals(buf)).toBe(true);
  });

  it('reads a <meta charset> when the header has none', () => {
    const buf = Buffer.from('<meta charset="iso-8859-2"><p>é</p>', 'latin1');
    expect(decodeBody(buf, 'text/html').encoding).toBe('latin1');
  });

  it('falls back to latin1 for invalid UTF-8 without a declaration', () => {
    const buf = Buffer.from([0x61, 0xff, 0x62]);
    const d = decodeBody(buf, undefined);
    expect(d.encoding).toBe('latin1');
    expect(encodeBody(d.text, d.encoding).equals(buf)).toBe(true);
  });
});

describe('contentTypeForPath', () => {
  it('maps common extensions', () => {
    expect(contentTypeForPath('a/index.html')).toBe('text/html');
    expect(contentTypeForPath('a/style.CSS')).toBe('text/css');
    expect(contentTypeForPath('x.woff2')).toBe('font/woff2');
    expect(contentTypeForPath('x.unknownext')).toBe('application/octet-stream');
  });
});

describe('sleep', () => {
  it('rejects when aborted', async () => {
    const ac = new AbortController();
    const p = sleep(10000, ac.signal);
    ac.abort();
    await expect(p).rejects.toBeDefined();
  });
});

describe('declareUtf8', () => {
  it('points the first charset declaration at UTF-8', () => {
    expect(declareUtf8('<meta charset="windows-1250"><p>x</p>')).toBe('<meta charset="utf-8"><p>x</p>');
    expect(declareUtf8('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2">')).toBe(
      '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
    );
    expect(declareUtf8('<p>no meta</p>')).toBe('<meta charset="utf-8"><p>no meta</p>');
    expect(declareUtf8('<!doctype html><html><head><title>t</title></head>')).toBe(
      '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head>',
    );
    expect(declareUtf8('<!DOCTYPE html><html lang="sr"><body>x</body>')).toBe(
      '<!DOCTYPE html><html lang="sr"><meta charset="utf-8"><body>x</body>',
    );
    expect(declareUtf8('<!doctype html><p>x</p>')).toBe('<!doctype html><meta charset="utf-8"><p>x</p>');
  });
});
