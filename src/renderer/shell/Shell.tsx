import { useApp } from '../state/AppProvider';
import { ProgressScreen } from '../screens/ProgressScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StartScreen } from '../screens/StartScreen';
import { Rail } from './Rail';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';

export function Shell() {
  const { model } = useApp();
  if (model.loadError) {
    return (
      <div className="boot">
        <div className="glass notice err" role="alert">
          Trawler could not start: {model.loadError}
        </div>
      </div>
    );
  }
  if (!model.ready) return <div className="boot">Loading...</div>;
  return (
    <div className="app">
      <TitleBar />
      <Rail />
      <main className="stage">
        <section className="screen" key={model.screen}>
          {model.screen === 'start' ? <StartScreen /> : model.screen === 'progress' ? <ProgressScreen /> : <SettingsScreen />}
        </section>
      </main>
      <StatusBar />
    </div>
  );
}
