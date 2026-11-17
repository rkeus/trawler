import type { HistoryEntry } from '../../shared/ipc';
import { Tag } from '../components/Tag';
import { describeResult, displayUrl, formatWhen } from '../state/format';

export function RecentList({
  entries,
  busy,
  onRepeat,
  onFolder,
  onPreview,
  onRemove,
  onClear,
}: {
  entries: HistoryEntry[];
  busy: boolean;
  onRepeat: (entry: HistoryEntry) => void;
  onFolder: (entry: HistoryEntry) => void;
  onPreview: (entry: HistoryEntry) => void;
  onRemove: (entry: HistoryEntry) => void;
  onClear: () => void;
}) {
  return (
    <>
      <div className="cap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Recent</span>
        {entries.length > 0 && (
          <button type="button" className="btn sm" onClick={onClear}>
            Clear history
          </button>
        )}
      </div>
      <div className="glass scroll">
        {entries.length === 0 ? (
          <div className="empty">Nothing yet. Your analyses and downloads will show up here.</div>
        ) : (
          <ul className="recent" aria-label="Recent jobs">
            {entries.map((e) => {
              const result = describeResult(e);
              const hasCopy = e.kind === 'download' && Boolean(e.outputDir);
              return (
                <li key={e.id}>
                  <span className="url">{displayUrl(e.seedUrl)}</span>
                  <span className="m" title={e.outputDir}>
                    {e.outputDir ?? 'analysis only'}
                  </span>
                  <span>
                    <Tag kind={e.verdict ?? e.mode} />
                  </span>
                  <span className="m">{formatWhen(e.finishedAt)}</span>
                  <span className={result.tone === 'ok' ? 'ok' : result.tone === 'warn' ? 'wn' : result.tone === 'err' ? 'er' : 'm'}>{result.text}</span>
                  <span className="acts">
                    <button type="button" className="btn sm" disabled={busy} onClick={() => onRepeat(e)}>
                      Repeat
                    </button>
                    {hasCopy && (
                      <button type="button" className="btn sm" onClick={() => onFolder(e)}>
                        Folder
                      </button>
                    )}
                    {hasCopy && (
                      <button type="button" className="btn sm" onClick={() => onPreview(e)}>
                        Preview
                      </button>
                    )}
                    <button type="button" className="btn sm" aria-label="Remove" title="Remove from history" onClick={() => onRemove(e)}>
                      x
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
