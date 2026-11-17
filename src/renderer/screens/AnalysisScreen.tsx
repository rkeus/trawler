import { useState, type CSSProperties } from 'react';
import type { Settings } from '../../shared/settings';
import { errorText } from '../api';
import { Field } from '../components/Field';
import { Tag } from '../components/Tag';
import { useApp } from '../state/AppProvider';
import { displayUrl } from '../state/format';
import { FIELDS, parseFields, toDraft, type Draft } from '../state/settings-form';
import { useLauncher } from '../state/useLauncher';
import { FolderPolicyDialog } from './FolderPolicyDialog';

/** The settings the analysis lets the user adjust before the download. */
const RECOMMENDABLE = ['mode', 'downloadExternal', 'maxDepth', 'maxPages', 'concurrency', 'requestDelayMs'] as const;
/** Most pages drawn in the list at once; the filter narrows it. */
const PAGE_LIST_LIMIT = 200;
const HOSTS_SHOWN = 10;

const VERDICT_TEXT = { static: 'Static', hybrid: 'Server-rendered', js: 'Built by JavaScript' } as const;

export function AnalysisScreen() {
  const { model, api, dispatch } = useApp();
  const launcher = useLauncher();
  const finished = model.finished!;
  const analysis = finished.result.analysis!;
  const saved = model.settings!.settings;
  // the settings the analysis ran with (Start's per-job changes included), else the saved ones; recommendations go on top.
  // The download sends these too (the form's values win), so the job's other settings (user agent, excludes, ...) are kept.
  const base: Settings = finished.history?.settings ?? saved;
  const recommended = analysis.recommended;
  const [draft, setDraft] = useState<Draft>(() => toDraft({ ...base, ...recommended }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [outputDir, setOutputDir] = useState<string | undefined>(model.appState!.lastOutputDir);
  const [filter, setFilter] = useState('');

  const detection = analysis.detection;
  const assets = Object.entries(analysis.assetCounts).filter(([kind, n]) => kind !== 'page' && n > 0);
  const assetTotal = assets.reduce((sum, [, n]) => sum + n, 0);
  const warnings = [...new Set([...analysis.warnings, ...finished.result.warnings])];
  const needle = filter.trim().toLowerCase();
  const matching = analysis.pages.filter((p) => p.toLowerCase().includes(needle));
  const reuse = saved.analysisCacheTtlMs > 0 && saved.analysisCacheMaxBytes > 0;

  async function chooseFolder(): Promise<void> {
    try {
      const dir = await api.chooseFolder(outputDir);
      if (dir) setOutputDir(dir);
    } catch (err) {
      launcher.setError(errorText(err));
    }
  }

  function download(): void {
    const parsed = parseFields(draft, RECOMMENDABLE);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    if (!outputDir) {
      launcher.setError('Choose an output folder first.');
      return;
    }
    void launcher.launch({ kind: 'download', seedUrl: analysis.seedUrl, outputDir, settings: { ...(finished.history?.settings ?? {}), ...parsed.values } });
  }

  return (
    <>
      <h1>
        {displayUrl(analysis.seedUrl)}
        {detection && <Tag kind={detection.verdict} />}
        {detection && <span className="hint">{[...detection.frameworks, ...detection.uiKits].join(' - ')}</span>}
      </h1>
      {launcher.error && (
        <div className="glass notice err" role="alert">
          {launcher.error}
        </div>
      )}
      <div className="grid2">
        <div>
          {detection ? (
            <div className="glass verdict">
              <div className={`ring ${detection.verdict}`} style={{ '--score': Math.round(Math.min(1, detection.score) * 100) } as CSSProperties}>
                <div>{detection.score.toFixed(2)}</div>
              </div>
              <b>{VERDICT_TEXT[detection.verdict]}</b>
            </div>
          ) : (
            <div className="glass verdict">
              <b>{analysis.mode === 'js' ? 'JS' : 'Static'} mode</b>
              <div className="hint">chosen by you, so nothing was detected</div>
            </div>
          )}
          <div className="glass card" style={{ marginTop: 12 }}>
            <div className="cap" style={{ marginTop: 0 }}>Download settings</div>
            <div style={{ display: 'grid', gap: 10 }}>
              {FIELDS.filter((f) => (RECOMMENDABLE as readonly string[]).includes(f.key)).map((spec) => (
                <Field
                  key={spec.key}
                  spec={spec}
                  value={draft[spec.key]}
                  error={errors[spec.key]}
                  recommended={spec.key in recommended}
                  onChange={(v) => setDraft((d) => ({ ...d, [spec.key]: v }))}
                />
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="nums">
            <div className="glass num"><b>{analysis.pages.length}</b><span>pages</span></div>
            <div className="glass num"><b>{assetTotal}</b><span>assets</span></div>
            <div className="glass num"><b>{analysis.externalHosts.length}</b><span>external hosts</span></div>
          </div>
          {detection && detection.explanations.length > 0 && (
            <div className="glass card" style={{ marginTop: 12 }}>
              <div className="cap" style={{ marginTop: 0 }}>Why</div>
              <ul className="plain">
                {detection.explanations.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="glass card" style={{ marginTop: 12 }}>
            <div className="cap" style={{ marginTop: 0 }}>{`Pages - ${analysis.pages.length}`}</div>
            <input className="filter" aria-label="Filter pages" placeholder="Filter" spellCheck={false} value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="pages mono">
              {matching.slice(0, PAGE_LIST_LIMIT).map((p) => (
                <div key={p}>{p}</div>
              ))}
              {matching.length > PAGE_LIST_LIMIT && <div>{`... ${matching.length - PAGE_LIST_LIMIT} more`}</div>}
              {matching.length === 0 && <div>No page matches.</div>}
            </div>
          </div>
          {(assets.length > 0 || analysis.externalHosts.length > 0) && (
            <div className="glass card" style={{ marginTop: 12 }}>
              {assets.length > 0 && (
                <div className="kv">
                  {assets.map(([kind, n]) => (
                    <span key={kind}>
                      {kind} <b>{n}</b>
                    </span>
                  ))}
                </div>
              )}
              {analysis.externalHosts.length > 0 && (
                <div className="kv" style={{ marginTop: assets.length > 0 ? 8 : 0 }}>
                  {analysis.externalHosts.slice(0, HOSTS_SHOWN).map((h) => (
                    <span key={h.host} className="mono">
                      <b>{h.host}</b> {h.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {warnings.length > 0 && (
            <div className="glass card notice" style={{ marginTop: 12, display: 'block' }}>
              <b className="wn">{warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`}</b>
              <ul className="plain">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <div className="chips">
        <span className="glass chip">
          <b>{outputDir ?? 'No folder chosen'}</b>
          <button type="button" className="btn sm" aria-label="Choose output folder" onClick={() => void chooseFolder()}>
            {outputDir ? 'Change' : 'Choose'}
          </button>
        </span>
      </div>
      <div className="actions">
        <button type="button" className="btn go" onClick={download}>
          Download with these settings
        </button>
        <button type="button" className="btn" onClick={() => dispatch({ type: 'dismiss-finished' })}>
          Back
        </button>
        {reuse && <span className="hint">Pages already fetched by this analysis are reused.</span>}
      </div>
      {launcher.pending && <FolderPolicyDialog dir={launcher.pending.outputDir!} onChoose={launcher.choosePolicy} onCancel={launcher.cancelPending} />}
    </>
  );
}
