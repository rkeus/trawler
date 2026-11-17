import { session, type Session } from 'electron';
import { configureJobSession } from './job-session';
import { withTimeout } from './with-timeout';

/**
 * The desktop app runs one job at a time and reuses two in-memory sessions (crawl and verification) for all jobs.
 * Electron never frees a partition, so one partition per job would grow memory for the app's whole life.
 * reset() gives every job empty cookies, cache and storage.
 */
export class AppSessions {
  readonly job: Session;
  readonly verify: Session;
  private readonly defaultUserAgent: string;

  constructor() {
    this.job = configureJobSession(session.fromPartition('trawler-app-job'));
    this.verify = configureJobSession(session.fromPartition('trawler-app-verify'));
    this.defaultUserAgent = this.job.getUserAgent(); // already cleaned by configureJobSession
  }

  /**
   * Empties both sessions and sets the job's user agent ('' = Chromium's own). Waits at most `timeoutMs` for the
   * clean-up; `timedOut` tells the caller it was cut short (the job should still start).
   */
  async reset(userAgent: string, timeoutMs: number): Promise<{ timedOut: boolean }> {
    const clearing = Promise.allSettled(
      [this.job, this.verify].flatMap((s) => [
        s.closeAllConnections(),
        s.clearStorageData(),
        s.clearCache(),
        s.clearAuthCache(),
        s.clearHostResolverCache(),
      ]),
    );
    const outcome = await withTimeout(clearing, timeoutMs);
    this.job.setUserAgent(userAgent || this.defaultUserAgent);
    return { timedOut: outcome.timedOut };
  }
}
