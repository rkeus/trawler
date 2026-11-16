import { withChallengeSolver, type JobPorts } from '../engine';
import type { Settings } from '../shared/settings';
import { createBrowserVerifier } from './browser-verifier';
import { createCapturer } from './capturer';
import { createChallengeSolver } from './challenge-solver';
import { createJobSession } from './job-session';
import { createSessionFetch } from './session-fetch';

export interface ElectronPorts {
  ports: JobPorts;
  /** clears the job sessions' cookies and cache */
  dispose(): Promise<void>;
}

/** Wires the engine to Electron for one job: session requests, renderer, challenge solver and browser verifier. */
export function createElectronPorts(settings: Settings): ElectronPorts {
  const jobSession = createJobSession(settings.userAgent || undefined);
  const verifySession = createJobSession(); // the local copy is checked in a clean session
  const solver = createChallengeSolver(jobSession, settings.challengeTimeoutMs);
  return {
    ports: {
      fetchImpl: createSessionFetch(jobSession),
      capturer: createCapturer(jobSession, { maxBodyBytes: settings.memoryBodyLimitBytes }),
      verifier: createBrowserVerifier(createCapturer(verifySession, { maxBodyBytes: 0, collectBodies: false }), {
        timeoutMs: settings.renderTimeoutMs,
        networkIdleMs: settings.networkIdleMs,
        concurrency: settings.renderConcurrency,
      }),
      decorateFetcher: (fetcher, signal) => withChallengeSolver(fetcher, solver, signal),
    },
    dispose: async () => {
      await Promise.allSettled([jobSession.clearStorageData(), verifySession.clearStorageData()]);
    },
  };
}
