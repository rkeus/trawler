import { session, type Session } from 'electron';
import { configureJobSession } from './job-session';

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

  /** Empties both sessions and sets the job's user agent ('' = Chromium's own). */
  async reset(userAgent: string): Promise<void> {
    await Promise.allSettled(
      [this.job, this.verify].flatMap((s) => [
        s.closeAllConnections(),
        s.clearStorageData(),
        s.clearCache(),
        s.clearAuthCache(),
        s.clearHostResolverCache(),
      ]),
    );
    this.job.setUserAgent(userAgent || this.defaultUserAgent);
  }
}
