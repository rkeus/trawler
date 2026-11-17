import { useState } from 'react';
import { errorText } from '../api';
import { useApp } from '../state/AppProvider';
import { formatBytes } from '../state/format';

const HEADINGS = { done: 'Done', done_with_errors: 'Done with errors', cancelled: 'Cancelled', failed: 'Failed' } as const;
/** Most missing files listed; the report has all of them. */
const MISSING_SHOWN = 50;

/** How a job ended. For a download that left a folder: summary, errors, verification, preview, folder and report. */
export function ResultScreen() {
  const { model, api, dispatch } = useApp();
  const { result } = model.finished!;
  const errors = model.finishedErrors;
  const [actionError, setActionError] = useState('');
  const c = result.counters;
  const dir = result.outputDir;
  const hasCopy = result.kind === 'download' && Boolean(dir);
  const verify = result.verify;

  async function act(task: () => Promise<unknown>): Promise<void> {
    setActionError('');
    try {
      await task();
    } catch (err) {
      setActionError(errorText(err));
    }
  }

  const detail = [
    `${result.kind === 'analyze' ? 'Analysis' : 'Download'} - ${result.mode === 'js' ? 'JS' : 'static'} mode`,
    result.detection ? `detected ${result.detection.verdict}` : '',
    verify ? `${verify.pagesOk}/${verify.pagesChecked} pages verified, ${verify.missing.length} missing ${verify.missing.length === 1 ? 'file' : 'files'}` : '',
  ]
    .filter((s) => s !== '')
    .join(' - ');

  return (
    <>
      <div className="glass hero">
        <div>
          <h1>{HEADINGS[result.status]}</h1>
          <div className="hint">{detail}</div>
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
      {errors.length > 0 && (
        <div className="glass card" style={{ marginTop: 12 }}>
          <div className="cap" style={{ marginTop: 0 }}>Errors</div>
          <div className="mono" style={{ color: 'var(--muted)', lineHeight: 1.8 }}>
            {errors.map((l) => (
              <div key={l.id}>{l.url ? `${l.text} ${l.url}` : l.text}</div>
            ))}
          </div>
        </div>
      )}
      {verify && verify.missing.length > 0 && (
        <div className="glass card" style={{ marginTop: 12 }}>
          <div className="cap" style={{ marginTop: 0 }}>Missing files</div>
          <div className="mono" style={{ color: 'var(--muted)', lineHeight: 1.8 }}>
            {verify.missing.slice(0, MISSING_SHOWN).map((m, i) => (
              <div key={i}>
                {m.page} - {m.url} ({m.status ? `HTTP ${m.status}` : 'failed'})
              </div>
            ))}
            {verify.missing.length > MISSING_SHOWN && <div>{`... ${verify.missing.length - MISSING_SHOWN} more, see the report`}</div>}
          </div>
        </div>
      )}
      {result.warnings.length > 0 && (
        <div className="glass card" style={{ marginTop: 12 }}>
          <div className="cap" style={{ marginTop: 0 }}>Warnings</div>
          <ul className="plain">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {hasCopy && (
        <div className="glass card" style={{ marginTop: 12 }}>
          <div className="cap" style={{ marginTop: 0 }}>Saved to</div>
          <span className="mono">{dir}</span>
        </div>
      )}
      {actionError && (
        <div className="glass notice err" role="alert" style={{ marginTop: 12 }}>
          {actionError}
        </div>
      )}
      <div className="actions">
        {hasCopy && (
          <>
            <button
              type="button"
              className="btn go"
              onClick={() =>
                void act(async () => {
                  await api.startPreview(dir!);
                  await api.openPreview();
                })
              }
            >
              Run preview
            </button>
            <button type="button" className="btn" onClick={() => void act(() => api.openFolder(dir!))}>
              Open folder
            </button>
            <button type="button" className="btn" onClick={() => void act(() => api.openReport(dir!))}>
              Open report
            </button>
          </>
        )}
        <button type="button" className={hasCopy ? 'btn' : 'btn go'} onClick={() => dispatch({ type: 'dismiss-finished' })}>
          {hasCopy ? 'New download' : 'Back to start'}
        </button>
      </div>
    </>
  );
}
