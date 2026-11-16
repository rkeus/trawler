import { describe, it, expect } from 'vitest';
import { Frontier } from '../../../../src/core/crawl/frontier';

describe('Frontier', () => {
  it('returns items in BFS (insertion) order and dedupes', () => {
    const f = new Frontier({ maxDepth: 5, maxPages: 10 });
    expect(f.add('a', 0)).toBe(true);
    expect(f.add('b', 1)).toBe(true);
    expect(f.add('a', 1)).toBe(false);
    expect(f.next()).toEqual({ url: 'a', depth: 0 });
    expect(f.next()).toEqual({ url: 'b', depth: 1 });
    expect(f.next()).toBeUndefined();
    expect(f.has('a')).toBe(true);
  });

  it('rejects items deeper than maxDepth', () => {
    const f = new Frontier({ maxDepth: 1, maxPages: 10 });
    expect(f.add('deep', 2)).toBe(false);
    expect(f.limitReached).toBe(false);
  });

  it('stops at maxPages and flags it', () => {
    const f = new Frontier({ maxDepth: 5, maxPages: 2 });
    f.add('a', 0);
    f.add('b', 0);
    expect(f.add('c', 0)).toBe(false);
    expect(f.limitReached).toBe(true);
    expect(f.accepted).toBe(2);
  });

  it('reports pending count', () => {
    const f = new Frontier({ maxDepth: 5, maxPages: 5 });
    f.add('a', 0);
    f.add('b', 0);
    f.next();
    expect(f.pending).toBe(1);
  });
});
