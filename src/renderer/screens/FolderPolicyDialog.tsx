import type { ConcreteFolderPolicy } from '../../engine';

export function FolderPolicyDialog({
  dir,
  onChoose,
  onCancel,
}: {
  dir: string;
  onChoose: (policy: ConcreteFolderPolicy) => void;
  onCancel: () => void;
}) {
  return (
    <div className="overlay">
      <div className="glass dialog" role="dialog" aria-modal="true" aria-label="Output folder is not empty">
        <h2>The output folder is not empty</h2>
        <p className="mono">{dir}</p>
        <p>Overwrite replaces the previous Trawler download in it; files Trawler did not write stay. Merge keeps everything and adds the new files.</p>
        <div className="actions">
          <button type="button" className="btn go" onClick={() => onChoose('overwrite')}>
            Overwrite
          </button>
          <button type="button" className="btn" onClick={() => onChoose('merge')}>
            Merge
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
