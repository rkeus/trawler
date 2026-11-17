import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import type { StartJobRequest, TrawlerApi } from '../../shared/ipc';
import { errorText } from '../api';
import { applyAppearance } from '../theme';
import { initialModel, type Model } from './model';
import { reducer, type Action } from './reducer';

interface AppContextValue {
  model: Model;
  dispatch: Dispatch<Action>;
  api: TrawlerApi;
  /** starts a job and shows its progress; rejects with the API's error (for example "busy") */
  startJob: (request: StartJobRequest) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export function AppProvider({ api, children }: { api: TrawlerApi; children: ReactNode }) {
  const [model, dispatch] = useReducer(reducer, undefined, initialModel);

  useEffect(() => {
    let alive = true;
    // subscribe first, so nothing that happens while the first data loads is missed
    const offEvent = api.onJobEvent((msg) => dispatch({ type: 'job-event', msg, at: Date.now() }));
    const offDone = api.onJobFinished((msg) => dispatch({ type: 'job-finished', msg }));
    Promise.all([api.getSettings(), api.listHistory(), api.getAppState(), api.appInfo(), api.currentJob(), api.lastFinishedJob()])
      .then(([settings, history, appState, info, current, last]) => {
        if (alive) dispatch({ type: 'loaded', settings, history, appState, info, current, last, at: Date.now() });
      })
      .catch((err: unknown) => {
        if (alive) dispatch({ type: 'load-failed', message: errorText(err) });
      });
    return () => {
      alive = false;
      offEvent();
      offDone();
    };
  }, [api]);

  const theme = model.appState?.theme;
  const palette = model.appState?.palette;
  useEffect(() => {
    if (!theme || !palette) return;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const apply = (): void => applyAppearance(document.documentElement, theme, palette, media ? media.matches : true);
    apply();
    media?.addEventListener('change', apply);
    return () => media?.removeEventListener('change', apply);
  }, [theme, palette]);

  const startJob = useCallback(
    async (request: StartJobRequest): Promise<void> => {
      const response = await api.startJob(request);
      dispatch({
        type: 'job-started',
        request: { kind: request.kind, seedUrl: request.seedUrl, ...(request.outputDir ? { outputDir: request.outputDir } : {}) },
        response,
        startedAt: new Date().toISOString(),
        at: Date.now(),
      });
    },
    [api],
  );

  const value = useMemo(() => ({ model, dispatch, api, startJob }), [model, api, startJob]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
