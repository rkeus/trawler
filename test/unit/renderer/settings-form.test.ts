import { describe, it, expect } from 'vitest';
import { buildPatch, FIELDS, parseFields, toDraft } from '../../../src/renderer/state/settings-form';
import { DEFAULT_SETTINGS, resolveSettings, type Settings } from '../../../src/shared/settings';

const saved: Settings = resolveSettings({}).settings;

describe('settings form', () => {
  it('has a field for every setting except the two detection objects, which are split into numbers', () => {
    const keys = new Set(FIELDS.map((f) => f.key));
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key === 'detection') continue;
      expect(keys.has(key), key).toBe(true);
    }
    for (const key of ['detection.thresholds.static', 'detection.thresholds.js', 'detection.weights.emptyMount', 'detection.weights.moduleScripts']) {
      expect(keys.has(key), key).toBe(true);
    }
  });

  it('turns the settings into a draft and back without any change', () => {
    const r = buildPatch(toDraft(saved), saved);
    expect(r).toEqual({ ok: true, patch: {} });
  });

  it('puts lists one item per line', () => {
    const draft = toDraft({ ...saved, excludePatterns: ['a', 'b'] });
    expect(draft.excludePatterns).toBe('a\nb');
  });

  it('builds a patch of the changed values only', () => {
    const draft = { ...toDraft(saved), maxDepth: '7', respectRobotsTxt: false, excludePatterns: ' /admin \n\n/private ', userAgent: ' Bot/1 ' };
    expect(buildPatch(draft, saved)).toEqual({
      ok: true,
      patch: { maxDepth: 7, respectRobotsTxt: false, excludePatterns: ['/admin', '/private'], userAgent: 'Bot/1' },
    });
  });

  it('nests the detection values', () => {
    const draft = { ...toDraft(saved), 'detection.thresholds.js': '0.7', 'detection.weights.emptyMount': '0.4' };
    expect(buildPatch(draft, saved)).toEqual({
      ok: true,
      patch: { detection: { thresholds: { js: 0.7 }, weights: { emptyMount: 0.4 } } },
    });
  });

  it('reports every bad value by key', () => {
    const draft = { ...toDraft(saved), maxPages: 'many', concurrency: '2.5', 'detection.thresholds.static': 'x' };
    const r = buildPatch(draft, saved);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['concurrency', 'detection.thresholds.static', 'maxPages']);
  });

  it('parseFields returns the values of the asked keys, changed or not', () => {
    const r = parseFields(toDraft(saved), ['mode', 'maxPages', 'downloadExternal']);
    expect(r).toEqual({ ok: true, values: { mode: 'auto', maxPages: 500, downloadExternal: true } });
  });
});
