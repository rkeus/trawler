export type TimeoutResult<T> = { timedOut: false; value: T } | { timedOut: true };

/** Waits for `task` at most `ms`. The task itself is not stopped; a late result is ignored. */
export async function withTimeout<T>(task: Promise<T>, ms: number): Promise<TimeoutResult<T>> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<TimeoutResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  try {
    return await Promise.race([task.then((value): TimeoutResult<T> => ({ timedOut: false, value })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
