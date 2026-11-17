import { displayUrl } from '../state/format';
import { useApp } from '../state/AppProvider';

export function StatusBar() {
  const { model } = useApp();
  const job = model.job;
  return (
    <footer className="status">
      <span className={job ? 'live busy' : 'live'}>
        {job ? `${job.kind === 'analyze' ? 'Analyzing' : 'Downloading'} ${displayUrl(job.seedUrl)}` : 'Ready'}
      </span>
      <span>one job at a time</span>
      <span className="sp" />
      <span>{model.info ? `v${model.info.version}` : ''}</span>
    </footer>
  );
}
