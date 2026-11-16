import { describe, it, expect } from 'vitest';
import { parseSrcset, stringifySrcset } from '../../../../src/core/html/srcset';

describe('srcset', () => {
  it('parses density and width descriptors', () => {
    expect(parseSrcset('a.png 1x, b.png 2x')).toEqual([
      { url: 'a.png', descriptor: '1x' },
      { url: 'b.png', descriptor: '2x' },
    ]);
    expect(parseSrcset('a.png 480w,b.png 800w')).toEqual([
      { url: 'a.png', descriptor: '480w' },
      { url: 'b.png', descriptor: '800w' },
    ]);
  });
  it('parses a bare URL and a URL ending in a comma', () => {
    expect(parseSrcset('a.png')).toEqual([{ url: 'a.png', descriptor: '' }]);
    expect(parseSrcset('a.png, b.png 2x')).toEqual([
      { url: 'a.png', descriptor: '' },
      { url: 'b.png', descriptor: '2x' },
    ]);
  });
  it('keeps commas inside data URIs', () => {
    expect(parseSrcset('data:image/png;base64,AAA= 1x, b.png 2x')).toEqual([
      { url: 'data:image/png;base64,AAA=', descriptor: '1x' },
      { url: 'b.png', descriptor: '2x' },
    ]);
  });
  it('round-trips', () => {
    expect(stringifySrcset(parseSrcset('a.png 1x, b.png 2x'))).toBe('a.png 1x, b.png 2x');
  });
});
