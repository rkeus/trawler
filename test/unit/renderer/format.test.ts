import { describe, it, expect } from 'vitest';
import { describeResult, displayUrl, formatBytes, formatWhen, parentDir } from '../../../src/renderer/state/format';
import { historyEntry } from '../../helpers/history-entry';

describe('format', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });

  it('formats a local date and time', () => {
    expect(formatWhen(new Date(2026, 10, 17, 10, 12).toISOString())).toBe('17 Nov 10:12');
    expect(formatWhen(new Date(2026, 0, 5, 9, 3).toISOString())).toBe('5 Jan 09:03');
    expect(formatWhen('not a date')).toBe('');
  });

  it('shortens a URL for the list', () => {
    expect(displayUrl('https://example.com/template/index.html')).toBe('example.com/template');
    expect(displayUrl('https://example.com/')).toBe('example.com');
    expect(displayUrl('http://localhost:8080/a/b/')).toBe('localhost:8080/a/b');
    expect(displayUrl('nonsense')).toBe('nonsense');
  });

  it('describes how a job ended', () => {
    const base = historyEntry('h');
    const counters = { pagesDone: 111, pagesQueued: 111, assetsDone: 5, assetsQueued: 5, bytes: 1, errors: 0 };
    expect(describeResult({ ...base, kind: 'download', status: 'done', counters, verify: { pagesChecked: 111, pagesOk: 111, missing: 0 } })).toEqual({ text: '111 pages - verified', tone: 'ok' });
    expect(describeResult({ ...base, kind: 'download', status: 'done', counters, verify: { pagesChecked: 111, pagesOk: 100, missing: 4 } })).toEqual({ text: '111 pages - 4 missing files', tone: 'warn' });
    expect(describeResult({ ...base, kind: 'download', status: 'done_with_errors', counters: { ...counters, errors: 3 } })).toEqual({ text: '111 pages - 3 errors', tone: 'warn' });
    expect(describeResult({ ...base, kind: 'analyze', status: 'done', pagesFound: 48 })).toEqual({ text: '48 pages found', tone: 'muted' });
    expect(describeResult({ ...base, status: 'cancelled' })).toEqual({ text: 'cancelled', tone: 'warn' });
    expect(describeResult({ ...base, status: 'failed', error: 'HTTP 404' })).toEqual({ text: 'failed: HTTP 404', tone: 'err' });
  });

  it('finds the folder that contains a folder', () => {
    expect(parentDir('D:\\trawler\\travel\\site')).toBe('D:\\trawler\\travel');
    expect(parentDir('D:\\trawler\\travel\\site\\')).toBe('D:\\trawler\\travel');
    expect(parentDir('D:\\site')).toBe('D:\\');
    expect(parentDir('/home/me/site')).toBe('/home/me');
    expect(parentDir('/site')).toBe('/');
    expect(parentDir('D:\\')).toBeUndefined();
    expect(parentDir('site')).toBeUndefined();
    expect(parentDir(undefined)).toBeUndefined();
  });
});
