import type { TrawlerApi } from '../shared/ipc';
import { Shell } from './shell/Shell';
import { AppProvider } from './state/AppProvider';

export function App({ api }: { api: TrawlerApi }) {
  return (
    <AppProvider api={api}>
      <Shell />
    </AppProvider>
  );
}
