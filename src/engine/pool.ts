import { sleep } from './sleep';

export interface PoolOptions {
  concurrency: number;
  /** minimum spacing between task starts (politeness delay), default 0 */
  delayMs?: number;
  /** successful tasks needed to raise a reduced limit by one, default 20 */
  recoverAfter?: number;
}

/** Runs async tasks under a concurrency limit that halves on throttling and slowly recovers. */
export class AdaptivePool {
  private active = 0;
  private limit: number;
  private readonly max: number;
  private successes = 0;
  private nextStart = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly opts: PoolOptions) {
    this.max = Math.max(1, Math.floor(opts.concurrency));
    this.limit = this.max;
  }

  get concurrency(): number {
    return this.limit;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      const result = await task();
      this.onSuccess();
      return result;
    } finally {
      this.active--;
      this.drain();
    }
  }

  /** Halves the limit (minimum 1). Call when the server signals throttling (429/503). */
  reduce(): void {
    this.limit = Math.max(1, Math.floor(this.limit / 2));
    this.successes = 0;
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

  private async acquire(): Promise<void> {
    while (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    const delay = this.opts.delayMs ?? 0;
    if (delay > 0) {
      const now = Date.now();
      const startAt = Math.max(now, this.nextStart);
      this.nextStart = startAt + delay;
      if (startAt > now) await sleep(startAt - now);
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
