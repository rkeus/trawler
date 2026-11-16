import { describe, it, expect } from 'vitest';
import { withChallengeSolver } from '../../../src/engine/challenge';
import { FetchError, type Fetcher, type FetchedResource } from '../../../src/engine/types';

const ok = (url: string): FetchedResource => ({
  url, finalUrl: url, status: 200, contentType: 'text/plain', headers: {}, body: Buffer.from('ok'), size: 2,
});

function challengedUntilSolved(): Fetcher & { solved: boolean } {
  const f = {
    solved: false,
    async fetch(url: string) {
      if (!f.solved) throw new FetchError('Bot protection challenge (HTTP 403)', url, 'challenge', 403);
      return ok(url);
    },
  };
  return f;
}

describe('withChallengeSolver', () => {
  it('solves once and retries concurrent challenged requests', async () => {
    const inner = challengedUntilSolved();
    let solves = 0;
    const f = withChallengeSolver(
      inner,
      { solve: async () => { solves++; await new Promise((r) => setTimeout(r, 20)); inner.solved = true; return true; } },
      new AbortController().signal,
    );
    const [a, b] = await Promise.all([f.fetch('https://x.com/a'), f.fetch('https://x.com/b')]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(solves).toBe(1);
  });

  it('gives up after a failed solve and rethrows the challenge', async () => {
    const inner = challengedUntilSolved();
    let solves = 0;
    const f = withChallengeSolver(inner, { solve: async () => { solves++; return false; } }, new AbortController().signal);
    await expect(f.fetch('https://x.com/a')).rejects.toMatchObject({ reason: 'challenge' });
    await expect(f.fetch('https://x.com/b')).rejects.toMatchObject({ reason: 'challenge' });
    expect(solves).toBe(1);
  });

  it('passes other errors through untouched', async () => {
    const inner: Fetcher = { fetch: async (u) => Promise.reject(new FetchError('HTTP 404', u, 'http', 404)) };
    let solves = 0;
    const f = withChallengeSolver(inner, { solve: async () => { solves++; return true; } }, new AbortController().signal);
    await expect(f.fetch('https://x.com/a')).rejects.toMatchObject({ status: 404 });
    expect(solves).toBe(0);
  });
});
