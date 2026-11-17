import { describe, it, expect } from 'vitest';
import { buildStartRequest, normalizeUrlInput } from '../../../src/renderer/state/start-request';

describe('normalizeUrlInput', () => {
  it('adds https:// when there is no scheme and trims', () => {
    expect(normalizeUrlInput('  example.com/template ')).toEqual({ ok: true, url: 'https://example.com/template' });
    expect(normalizeUrlInput('http://localhost:8080/a')).toEqual({ ok: true, url: 'http://localhost:8080/a' });
    expect(normalizeUrlInput('localhost:8080/a')).toEqual({ ok: true, url: 'https://localhost:8080/a' });
  });

  it('rejects empty input and non-http schemes', () => {
    expect(normalizeUrlInput('   ')).toEqual({ ok: false, error: 'Enter the template URL.' });
    expect(normalizeUrlInput('ftp://example.com/')).toEqual({ ok: false, error: 'Only http and https URLs are supported.' });
    expect(normalizeUrlInput('file:///C:/x.html')).toEqual({ ok: false, error: 'Only http and https URLs are supported.' });
  });

  it('rejects text that is not a URL', () => {
    expect(normalizeUrlInput('http://')).toEqual({ ok: false, error: 'This does not look like a valid URL.' });
  });
});

describe('buildStartRequest', () => {
  it('builds an analysis without a folder', () => {
    expect(buildStartRequest({ kind: 'analyze', url: 'example.com', outputDir: undefined, mode: 'js', downloadExternal: false })).toEqual({
      ok: true,
      request: { kind: 'analyze', seedUrl: 'https://example.com/', settings: { mode: 'js', downloadExternal: false } },
    });
  });

  it('needs a folder for a download', () => {
    expect(buildStartRequest({ kind: 'download', url: 'example.com', outputDir: undefined, mode: 'auto', downloadExternal: true })).toEqual({
      ok: false,
      error: 'Choose an output folder first.',
    });
    expect(buildStartRequest({ kind: 'download', url: 'example.com', outputDir: 'D:\\out', mode: 'auto', downloadExternal: true })).toEqual({
      ok: true,
      request: { kind: 'download', seedUrl: 'https://example.com/', outputDir: 'D:\\out', settings: { mode: 'auto', downloadExternal: true } },
    });
  });

  it('passes the URL error through', () => {
    expect(buildStartRequest({ kind: 'analyze', url: '', outputDir: undefined, mode: 'auto', downloadExternal: true })).toEqual({
      ok: false,
      error: 'Enter the template URL.',
    });
  });
});
