import type { FetchedResource, Fetcher } from './types';

/**
 * Keeps the responses an analysis fetched (pages and stylesheets) so the download of the same template that follows
 * does not fetch them again (spec section 4.7). Only successful responses held in memory are kept, up to `maxBytes`
 * in total. Keys are the URLs exactly as requested.
 */
export class FetchCache {
  private readonly entries = new Map<string, FetchedResource>();
  private used = 0;

  constructor(private readonly maxBytes: number) {}

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.used;
  }

  /** Wraps a fetcher so that every successful in-memory response is remembered (until the budget is spent). */
  record(fetcher: Fetcher): Fetcher {
    return {
      fetch: async (url) => {
        const res = await fetcher.fetch(url);
        this.remember(url, res);
        return res;
      },
    };
  }

  /** Wraps a fetcher so that remembered responses are returned without a request. */
  serve(fetcher: Fetcher): Fetcher {
    return {
      fetch: async (url) => {
        const hit = this.entries.get(url);
        return hit ? { ...hit, headers: { ...hit.headers } } : fetcher.fetch(url);
      },
    };
  }

  clear(): void {
    this.entries.clear();
    this.used = 0;
  }

  private remember(url: string, res: FetchedResource): void {
    if (res.spilledBlobId || this.entries.has(url)) return;
    if (this.used + res.body.length > this.maxBytes) return;
    this.entries.set(url, res);
    this.used += res.body.length;
  }
}
