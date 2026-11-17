import type { ReactElement } from 'react';
import { useApp } from '../state/AppProvider';
import type { Screen } from '../state/model';

const ICONS: Record<Screen, ReactElement> = {
  start: (
    <svg viewBox="0 0 24 24">
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 19h14" />
    </svg>
  ),
  progress: (
    <svg viewBox="0 0 24 24">
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24">
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />
    </svg>
  ),
};

const ITEMS: { screen: Screen; label: string }[] = [
  { screen: 'start', label: 'Start' },
  { screen: 'progress', label: 'Progress' },
  { screen: 'settings', label: 'Settings' },
];

export function Rail() {
  const { model, dispatch } = useApp();
  return (
    <nav className="rail" aria-label="Screens">
      {ITEMS.map((item) => (
        <button
          key={item.screen}
          type="button"
          title={item.label}
          aria-label={item.label}
          aria-current={model.screen === item.screen ? 'page' : undefined}
          disabled={item.screen === 'progress' && !model.job && !model.finished}
          onClick={() => dispatch({ type: 'navigate', screen: item.screen })}
        >
          {ICONS[item.screen]}
        </button>
      ))}
    </nav>
  );
}
