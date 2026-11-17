import type { PaletteName } from '../../shared/ipc';

/** The swatch color of each accent (the same hues as tokens.css). */
export const PALETTE_SWATCH: Record<PaletteName, string> = {
  ember: '#f0955a',
  slate: '#8fb3d9',
  moss: '#9bc28a',
  sand: '#e3c06b',
  clay: '#e39aa8',
  ink: '#d7dce6',
};

export const PALETTE_LABEL: Record<PaletteName, string> = {
  ember: 'Ember',
  slate: 'Slate',
  moss: 'Moss',
  sand: 'Sand',
  clay: 'Clay',
  ink: 'Ink',
};
