export interface FrontierItem {
  url: string;
  depth: number;
}

export interface FrontierOptions {
  maxDepth: number;
  maxPages: number;
}

/** BFS page queue with dedupe, depth limit and page limit. */
export class Frontier {
  private readonly queue: FrontierItem[] = [];
  private head = 0;
  private readonly seen = new Set<string>();
  /** true once an add() was rejected because maxPages was reached */
  limitReached = false;

  constructor(private readonly opts: FrontierOptions) {}

  add(url: string, depth: number): boolean {
    if (this.seen.has(url)) return false;
    if (depth > this.opts.maxDepth) return false;
    if (this.seen.size >= this.opts.maxPages) {
      this.limitReached = true;
      return false;
    }
    this.seen.add(url);
    this.queue.push({ url, depth });
    return true;
  }

  next(): FrontierItem | undefined {
    return this.head < this.queue.length ? this.queue[this.head++] : undefined;
  }

  has(url: string): boolean {
    return this.seen.has(url);
  }

  get accepted(): number {
    return this.seen.size;
  }

  get pending(): number {
    return this.queue.length - this.head;
  }
}
