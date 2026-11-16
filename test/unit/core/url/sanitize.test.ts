import { describe, it, expect } from 'vitest';
import { sanitizeSegment, MAX_SEGMENT_LENGTH } from '../../../../src/core/url/sanitize';

describe('sanitizeSegment', () => {
  it('keeps normal names', () => {
    expect(sanitizeSegment('style.css')).toBe('style.css');
    expect(sanitizeSegment('my photo.png')).toBe('my photo.png');
  });
  it('replaces forbidden characters', () => {
    expect(sanitizeSegment('a:b*c?.png')).toBe('a_b_c_.png');
    expect(sanitizeSegment('a<b>"c|.png')).toBe('a_b__c_.png');
  });
  it('replaces decoded slashes (no traversal)', () => {
    expect(sanitizeSegment('a/b')).toBe('a_b');
    expect(sanitizeSegment('a\\b')).toBe('a_b');
  });
  it('neutralizes dot segments and empty names', () => {
    expect(sanitizeSegment('..')).toBe('_');
    expect(sanitizeSegment('.')).toBe('_');
    expect(sanitizeSegment('')).toBe('_');
  });
  it('strips trailing dots and spaces', () => {
    expect(sanitizeSegment('file. ')).toBe('file');
    expect(sanitizeSegment('name...')).toBe('name');
  });
  it('suffixes reserved device names', () => {
    expect(sanitizeSegment('CON')).toBe('CON_');
    expect(sanitizeSegment('con.txt')).toBe('con_.txt');
    expect(sanitizeSegment('COM1.png')).toBe('COM1_.png');
    expect(sanitizeSegment('CONSOLE.txt')).toBe('CONSOLE.txt');
  });
  it('shortens long segments, keeping the extension', () => {
    const long = 'x'.repeat(150) + '.png';
    const out = sanitizeSegment(long);
    expect(out.length).toBeLessThanOrEqual(MAX_SEGMENT_LENGTH);
    expect(out).toMatch(/-[0-9a-f]{8}\.png$/);
    expect(sanitizeSegment(long)).toBe(out);
  });
});
