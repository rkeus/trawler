import { describe, it, expect } from 'vitest';
import { applyAppearance, resolveTheme } from '../../../src/renderer/theme';

describe('theme', () => {
  it('resolves "system" with the OS preference and keeps explicit choices', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('writes the resolved theme and the palette to the root element', () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    applyAppearance(root, 'system', 'moss', false);
    expect(root.dataset).toEqual({ theme: 'light', palette: 'moss' });
  });
});
