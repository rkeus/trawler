import { useEffect, useRef, useState } from 'react';
import type { JobPhase } from '../../engine';
import { errorText } from '../api';
import { Tag } from '../components/Tag';
import { displayUrl, formatBytes } from '../state/format';
import { useApp } from '../state/AppProvider';
import type { JobView } from '../state/model';
import { AnalysisScreen } from './AnalysisScreen';

const DOWNLOAD_STEPS: JobPhase[] = ['detecting', 'crawling', 'rewriting', 'verifying', 'done'];
const ANALYZE_STEPS: JobPhase[] = ['detecting', 'crawling', 'done'];
const LABELS: Record<JobPhase, string> = {
  detecting: 'Detecting',
  crawling: 'Crawling',
  rewriting: 'Rewriting',
  verifying: 'Verifying',
  done: 'Done',
};

function Steps({ job }: { job: JobView }) {
  const steps = job.kind === 'analyze' ? ANALYZE_STEPS : DOWNLOAD_STEPS;
  const at = job.phase ? steps.indexOf(job.phase) : -1;
  return (
    <div className="steps" aria-label="Phases">
      {steps.map((s, i) => (
        <span key={s} className={i < at ? 'd' : i === at ? 'n' : ''} aria-current={i === at ? 'step' : undefined}>
          {LABELS[s]}
        </span>
      ))}
    </div>
  );
}

function Running({ job }: { job: JobView }) {
  const { api } = useApp();
  const [tab, setTab] = useState<'log' | 'errors'>('log');
  const [cancelError, setCancelError] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const c = job.counters;
  const percent = c.pagesQueued > 0 ? Math.min(100, Math.round((c.pagesDone / c.pagesQueued) * 100)) : 0;
  const errors = job.log.filter((l) => l.level === 'error');
  const shown = tab === 'errors' ? errors : job.log;

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, tab]);

  return (
    <>
      <h1>
        {job.kind === 'analyze' ? 'Analyzing' : 'Downloading'} {displayUrl(job.seedUrl)}
        {job.mode && <Tag kind={job.detection?.verdict ?? job.mode} />}
      </h1>
      <Steps job={job} />
      <div className="glass card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <b>{c.pagesDone} / {c.pagesQueued}</b>
          <span className="hint">pages - {percent}%</span>
        </div>
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <i style={{ width: `${percent}%` }} />
        </div>
        <div className="nums">
          <div className="num"><b>{c.assetsDone}</b><span>assets</span></div>
          <div className="num"><b>{formatBytes(c.bytes)}</b><span>downloaded</span></div>
          <div className="num"><b className={c.errors > 0 ? 'wn' : ''}>{c.errors}</b><span>errors</span></div>
        </div>
      </div>
      <div className="cap">Live</div>
      <div className="glass">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>
            Log
          </button>
          <button type="button" role="tab" aria-selected={tab === 'errors'} className={tab === 'errors' ? 'on' : ''} onClick={() => setTab('errors')}>
            {`Errors (${errors.length})`}
          </button>
        </div>
        <div className="log" ref={logRef}>
          {shown.map((l) => (
            <div key={l.id} className={l.level === 'error' ? 'e' : l.level === 'warn' ? 'w' : undefined}>
              {l.text}
              {l.url ? ` ${l.url}` : ''}
            </div>
          ))}
        </div>
      </div>
      {cancelError && (
        <div className="glass notice err" role="alert" style={{ marginTop: 10 }}>
          {cancelError}
        </div>
      )}
      <div className="actions">
        <button
          type="button"
          className="btn stop"
          onClick={() => {
            setCancelError('');
            api.cancelJob(job.jobId).catch((err: unknown) => setCancelError(errorText(err)));
          }}
        >
          Cancel
        </button>
        <span className="hint">Cancel keeps what was downloaded and writes a partial manifest.</span>
      </div>
    </>
  );
}

const HEADINGS = { done: 'Done', done_with_errors: 'Done with errors', cancelled: 'Cancelled', failed: 'Failed' } as const;

/** The result of the job that just ended. Plan 3b-2 replaces this with the Analysis and Done screens. */
function Finished() {
  const { model, dispatch } = useApp();
  const { result } = model.finished!;
  const c = result.counters;
  return (
    <>
      <div className="glass hero">
        <div>
          <h1>{HEADINGS[result.status]}</h1>
          <div className="hint">
            {result.kind === 'analyze' ? 'Analysis' : 'Download'} - {result.mode === 'js' ? 'JS' : 'static'} mode
          </div>
        </div>
      </div>
      {result.error && (
        <div className="glass notice err" role="alert">
          {result.error}
        </div>
      )}
      <div className="glass card nums">
        <div className="num"><b>{c.pagesDone}</b><span>pages</span></div>
        <div className="num"><b>{c.assetsDone}</b><span>assets</span></div>
        <div className="num"><b>{formatBytes(c.bytes)}</b><span>size</span></div>
        <div className="num"><b className={c.errors > 0 ? 'wn' : ''}>{c.errors}</b><span>errors</span></div>
      </div>
      {result.warnings.length > 0 && (
        <div className="glass card" style={{ marginTop: 12 }}>
          <div className="cap" style={{ marginTop: 0 }}>Warnings</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)' }}>
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn go" onClick={() => dispatch({ type: 'dismiss-finished' })}>
          Back to start
        </button>
      </div>
    </>
  );
}

export function ProgressScreen() {
  const { model } = useApp();
  if (model.job) return <Running job={model.job} />;
  if (model.finished) return model.finished.result.analysis ? <AnalysisScreen /> : <Finished />;
  return null;
}
