import { describe, it, expect } from 'vitest';
import { AdaptivePool } from '../../../src/engine/pool';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('AdaptivePool', () => {
  it('never runs more tasks than the limit', async () => {
    const pool = new AdaptivePool({ concurrency: 2 });
    let active = 0;
    let peak = 0;
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const runs = gates.map((g) =>
      pool.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await g.promise;
        active--;
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(active).toBe(2);
    gates.forEach((g) => g.resolve());
    await Promise.all(runs);
    expect(peak).toBe(2);
  });

  it('propagates task results and errors', async () => {
    const pool = new AdaptivePool({ concurrency: 1 });
    await expect(pool.run(async () => 42)).resolves.toBe(42);
    await expect(pool.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(pool.run(async () => 'next')).resolves.toBe('next');
  });

  it('halves the limit on reduce() and recovers after successes', async () => {
    const pool = new AdaptivePool({ concurrency: 8, recoverAfter: 2, reduceCooldownMs: 0 });
    pool.reduce();
    expect(pool.concurrency).toBe(4);
    pool.reduce();
    pool.reduce();
    pool.reduce();
    expect(pool.concurrency).toBe(1);
    await pool.run(async () => undefined);
    await pool.run(async () => undefined);
    expect(pool.concurrency).toBe(2);
  });

  it('spaces task starts by delayMs', async () => {
    const pool = new AdaptivePool({ concurrency: 4, delayMs: 40 });
    const starts: number[] = [];
    await Promise.all([1, 2, 3].map(() => pool.run(async () => void starts.push(Date.now()))));
    expect(starts[2]! - starts[0]!).toBeGreaterThanOrEqual(70);
  });

  it('ignores reduce() calls within the cooldown', () => {
    let t = 0;
    const pool = new AdaptivePool({ concurrency: 8, reduceCooldownMs: 1000, now: () => t });
    expect(pool.reduce()).toBe(true);
    t = 500;
    expect(pool.reduce()).toBe(false);
    expect(pool.concurrency).toBe(4);
    t = 1600;
    expect(pool.reduce()).toBe(true);
    expect(pool.concurrency).toBe(2);
  });

  it('skips start spacing once the signal is aborted', async () => {
    const pool = new AdaptivePool({ concurrency: 1, delayMs: 100 });
    const ac = new AbortController();
    const t0 = Date.now();
    const runs = Array.from({ length: 30 }, () => pool.run(async () => undefined, ac.signal));
    setTimeout(() => ac.abort(), 20);
    await Promise.all(runs);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
