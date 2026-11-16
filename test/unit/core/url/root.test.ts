import { describe, it, expect } from 'vitest';
import { computeRootPath } from '../../../../src/core/url/root';

describe('computeRootPath', () => {
  it('keeps the base path when everything is below it', () => {
    expect(computeRootPath('/html/', ['/html/index.html', '/html/assets/a.css'])).toBe('/html/');
  });
  it('moves up to cover assets above the base path', () => {
    expect(computeRootPath('/html/', ['/html/index.html', '/assets/a.css'])).toBe('/');
    expect(computeRootPath('/a/b/', ['/a/b/x.html', '/a/c/y.css'])).toBe('/a/');
  });
  it('treats a base path without trailing slash as a file path', () => {
    expect(computeRootPath('/html', ['/html/x.html'])).toBe('/');
    expect(computeRootPath('/html/index.html', [])).toBe('/html/');
    expect(computeRootPath('/', [])).toBe('/');
  });
});
