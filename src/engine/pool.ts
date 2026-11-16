import { sleep } from './sleep';

export interface PoolOptions {
  concurrency: number;
  /** minimum spacing between task starts (politeness delay), default 0 */
  delayMs?: number;
  /** successful tasks needed to raise a reduced limit by one, default 20 */
  recoverAfter?: number;
  /** reduce() calls closer together than this are ignored (one throttling burst = one halving), default 1000 */
  reduceCooldownMs?: number;
  /** injectable clock for tests */
  now?: () => number;
}

/** Runs async tasks under a concurrency limit that halves on throttling and slowly recovers. */
export class AdaptivePool {
  private active = 0;
  private limit: number;
  private readonly max: number;
  private successes = 0;
  private nextStart = 0;
  private lastReduce = Number.NEGATIVE_INFINITY;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly opts: PoolOptions) {
    this.max = Math.max(1, Math.floor(opts.concurrency));
    this.limit = this.max;
  }

  get concurrency(): number {
    return this.limit;
  }

  /** `signal`: once aborted, queued tasks skip the start spacing (they are expected to bail out quickly). */
  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      const result = await task();
      this.onSuccess();
      return result;
    } finally {
      this.active--;
      this.drain();
    }
  }

  /** Halves the limit (minimum 1), at most once per cooldown. Returns true if the limit changed. */
  reduce(): boolean {
    const now = (this.opts.now ?? Date.now)();
    if (now - this.lastReduce < (this.opts.reduceCooldownMs ?? 1000)) return false;
    this.lastReduce = now;
    const before = this.limit;
    this.limit = Math.max(1, Math.floor(this.limit / 2));
    this.successes = 0;
    return this.limit !== before;
  }

  private onSuccess(): void {
    if (this.limit >= this.max) return;
    this.successes++;
    if (this.successes >= (this.opts.recoverAfter ?? 20)) {
      this.limit++;
      this.successes = 0;
      this.drain();
    }
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    while (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    const delay = this.opts.delayMs ?? 0;
    if (delay > 0 && !signal?.aborted) {
      const now = Date.now();
      const startAt = Math.max(now, this.nextStart);
      this.nextStart = startAt + delay;
      if (startAt > now) {
        try {
          await sleep(startAt - now, signal);
        } catch {
          // cancelled: start at once; the task bails out by itself
        }
      }
    }
  }

  private drain(): void {
    let free = this.limit - this.active;
    while (free > 0 && this.waiters.length > 0) {
      this.waiters.shift()!();
      free--;
    }
  }
}
