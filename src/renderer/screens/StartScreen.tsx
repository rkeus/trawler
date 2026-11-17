import { useState } from 'react';
import type { JobKind } from '../../engine';
import type { HistoryEntry } from '../../shared/ipc';
import type { Mode } from '../../shared/types';
import { errorText } from '../api';
import { LogoMark } from '../components/Logo';
import { Seg } from '../components/Seg';
import { Switch } from '../components/Switch';
import { useApp } from '../state/AppProvider';
import { buildStartRequest } from '../state/start-request';
import { useLauncher } from '../state/useLauncher';
import { FolderPolicyDialog } from './FolderPolicyDialog';
import { RecentList } from './RecentList';

const MODES: { value: Mode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'static', label: 'Static' },
  { value: 'js', label: 'JS' },
];

export function StartScreen() {
  const { model, api, dispatch } = useApp();
  const { error, setError, pending, launch, choosePolicy, cancelPending } = useLauncher();
  const settings = model.settings!.settings;
  const appState = model.appState!;
  const busy = model.job !== null;

  const [url, setUrl] = useState('');
  const [outputDir, setOutputDir] = useState<string | undefined>(appState.lastOutputDir);
  const [mode, setMode] = useState<Mode>(settings.mode);
  const [external, setExternal] = useState(settings.downloadExternal);

  function submit(kind: JobKind): void {
    const built = buildStartRequest({ kind, url, outputDir, mode, downloadExternal: external });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    void launch(built.request);
  }

  async function chooseFolder(): Promise<void> {
    try {
      const dir = await api.chooseFolder(outputDir);
      if (dir) setOutputDir(dir);
    } catch (err) {
      setError(errorText(err));
    }
  }

  function repeat(entry: HistoryEntry): void {
    void launch({
      kind: entry.kind,
      seedUrl: entry.seedUrl,
      ...(entry.outputDir ? { outputDir: entry.outputDir } : {}),
      settings: { ...entry.settings },
    });
  }

  async function guarded(task: () => Promise<unknown>): Promise<void> {
    setError('');
    try {
      await task();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function acceptNote(): Promise<void> {
    await guarded(async () => dispatch({ type: 'app-state', state: await api.updateAppState({ legalNoteAccepted: true }) }));
  }

  return (
    <>
      <div className="brandhead">
        <div>
          <div className="name">TRAWLER</div>
          <div className="tag-line">Cast a URL. Haul back the whole template.</div>
        </div>
        <div className="logo-big">
          <LogoMark />
        </div>
      </div>

      {!appState.legalNoteAccepted && (
        <div className="glass notice">
          <span className="grow">
            Use Trawler only on templates you own a license for, free templates, or your own sites. Mirroring a paid template's demo without a license
            infringes the author's copyright.
          </span>
          <button type="button" className="btn sm" onClick={() => void acceptNote()}>
            Got it
          </button>
        </div>
      )}

      {error && (
        <div className="glass notice err" role="alert">
          {error}
        </div>
      )}

      <form
        className="glass cmd"
        onSubmit={(e) => {
          e.preventDefault();
          submit('analyze');
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
        </svg>
        <input
          aria-label="Template URL"
          placeholder="https://example.com/template/index.html"
          spellCheck={false}
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="button" className="btn" disabled={busy} onClick={() => submit('analyze')}>
          Analyze
        </button>
        <button type="button" className="btn go" disabled={busy} onClick={() => submit('download')}>
          Download
        </button>
      </form>

      <div className="chips">
        <span className="glass chip">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 7h6l2 2h10v10H3z" />
          </svg>
          <b>{outputDir ?? 'No folder chosen'}</b>
          <button type="button" className="btn sm" aria-label="Choose output folder" onClick={() => void chooseFolder()}>
            {outputDir ? 'Change' : 'Choose'}
          </button>
        </span>
        <Seg options={MODES} value={mode} onChange={setMode} label="Mode" />
        <span className="glass chip">
          <Switch checked={external} onChange={setExternal}>
            External assets local
          </Switch>
        </span>
        <span className="glass chip">
          Depth <b>{settings.maxDepth}</b> &middot; Pages <b>{settings.maxPages}</b> &middot; Parallel <b>{settings.concurrency}</b>
        </span>
      </div>

      {model.history.length === 0 && (
        <>
          <div className="welcome">
            <div className="glass intro">
              <b>What it does</b>
              <span className="t">
                Trawler downloads a website template with all its pages, styles, scripts, images and fonts into a folder, in the same structure as on
                the server, so it works offline.
              </span>
            </div>
            <div className="glass step">
              <div className="k">1</div>
              <b>Paste a link</b>
              <span className="t">The template's demo URL, e.g. its index.html.</span>
            </div>
            <div className="glass step">
              <div className="k">2</div>
              <b>Analyze</b>
              <span className="t">Trawler sounds it out: static HTML or built by JavaScript, how many pages, what it loads from elsewhere.</span>
            </div>
            <div className="glass step">
              <div className="k">3</div>
              <b>Download</b>
              <span className="t">Get a working local copy, checked page by page. Preview it in your browser.</span>
            </div>
          </div>
        </>
      )}

      <RecentList
        entries={model.history}
        busy={busy}
        onRepeat={repeat}
        onFolder={(e) => void guarded(() => api.openFolder(e.outputDir!))}
        onPreview={(e) =>
          void guarded(async () => {
            await api.startPreview(e.outputDir!);
            await api.openPreview();
          })
        }
        onRemove={(e) => void guarded(async () => dispatch({ type: 'history', entries: await api.removeHistory(e.id) }))}
        onClear={() => void guarded(async () => dispatch({ type: 'history', entries: await api.clearHistory() }))}
      />

      {pending && <FolderPolicyDialog dir={pending.outputDir!} onChoose={choosePolicy} onCancel={cancelPending} />}
    </>
  );
}
