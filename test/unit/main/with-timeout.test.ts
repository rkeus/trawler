import { afterEach, describe, it, expect, vi } from 'vitest';
import { withTimeout } from '../../../src/main/with-timeout';

afterEach(() => vi.useRealTimers());

describe('withTimeout', () => {
  it('returns the value when the task is fast, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    expect(await withTimeout(Promise.resolve(7), 1000)).toEqual({ timedOut: false, value: 7 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a timeout when the task never settles', async () => {
    vi.useFakeTimers();
    const result = withTimeout(new Promise<number>(() => undefined), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ timedOut: true });
  });

  it('passes a rejection through', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });
});
