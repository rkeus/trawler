import type { PaletteName, ThemeChoice } from '../shared/ipc';

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'dark' | 'light' {
  return choice === 'system' ? (prefersDark ? 'dark' : 'light') : choice;
}

/** Sets data-theme and data-palette on the root element; tokens.css reacts to them. */
export function applyAppearance(
  root: { dataset: Record<string, string | undefined> },
  theme: ThemeChoice,
  palette: PaletteName,
  prefersDark: boolean,
): void {
  root.dataset.theme = resolveTheme(theme, prefersDark);
  root.dataset.palette = palette;
}
