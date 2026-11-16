import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, resolveSettings, compileExcludePatterns } from '../../../src/shared/settings';

describe('resolveSettings', () => {
  it('returns defaults for undefined input', () => {
    const { settings, warnings } = resolveSettings(undefined);
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(warnings).toEqual([]);
  });

  it('does not mutate DEFAULT_SETTINGS', () => {
    const { settings } = resolveSettings({ maxPages: 10 });
    expect(settings.maxPages).toBe(10);
    expect(DEFAULT_SETTINGS.maxPages).toBe(500);
  });

  it('has the spec defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      mode: 'auto',
      downloadExternal: true,
      maxDepth: 5,
      maxPages: 500,
      concurrency: 6,
      requestTimeoutMs: 30000,
      retries: 2,
      requestDelayMs: 0,
      renderTimeoutMs: 15000,
      networkIdleMs: 1000,
      autoScroll: true,
      analyzeRenderPages: 5,
      userAgent: '',
      respectRobotsTxt: true,
      excludePatterns: [],
      extraSeeds: [],
      rewriteJsAbsoluteUrls: false,
      nonEmptyFolder: 'ask',
      verifyAfterDownload: true,
      historySize: 20,
      detection: {
        thresholds: { static: 0.3, js: 0.6 },
        weights: { emptyMount: 0.3, textRatio: 0.25, frameworkMarkers: 0.3, dataRequests: 0.1, moduleScripts: 0.05 },
      },
    });
  });

  it('clamps out-of-range integers with a warning', () => {
    const { settings, warnings } = resolveSettings({ concurrency: 100, maxDepth: -3 });
    expect(settings.concurrency).toBe(32);
    expect(settings.maxDepth).toBe(0);
    expect(warnings).toHaveLength(2);
  });

  it('falls back to default on wrong type', () => {
    const { settings, warnings } = resolveSettings({ maxPages: 'many', autoScroll: 'yes', mode: 'turbo' });
    expect(settings.maxPages).toBe(500);
    expect(settings.autoScroll).toBe(true);
    expect(settings.mode).toBe('auto');
    expect(warnings).toHaveLength(3);
  });

  it('accepts valid enum and boolean values', () => {
    const { settings, warnings } = resolveSettings({ mode: 'js', nonEmptyFolder: 'merge', downloadExternal: false });
    expect(settings.mode).toBe('js');
    expect(settings.nonEmptyFolder).toBe('merge');
    expect(settings.downloadExternal).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('drops invalid regex exclude patterns', () => {
    const { settings, warnings } = resolveSettings({ excludePatterns: ['logout', '([unclosed'] });
    expect(settings.excludePatterns).toEqual(['logout']);
    expect(warnings).toHaveLength(1);
  });

  it('drops non-http extra seeds', () => {
    const { settings, warnings } = resolveSettings({ extraSeeds: ['https://x.com/a.html', 'ftp://x.com', 'nope'] });
    expect(settings.extraSeeds).toEqual(['https://x.com/a.html']);
    expect(warnings).toHaveLength(2);
  });

  it('keeps default thresholds when static >= js', () => {
    const { settings, warnings } = resolveSettings({ detection: { thresholds: { static: 0.7, js: 0.5 } } });
    expect(settings.detection.thresholds).toEqual({ static: 0.3, js: 0.6 });
    expect(warnings).toHaveLength(1);
  });

  it('accepts custom weights', () => {
    const { settings } = resolveSettings({ detection: { weights: { emptyMount: 0.5 } } });
    expect(settings.detection.weights.emptyMount).toBe(0.5);
    expect(settings.detection.weights.textRatio).toBe(0.25);
  });

  it('warns on unknown keys and non-object input', () => {
    expect(resolveSettings({ bogus: 1 }).warnings).toHaveLength(1);
    expect(resolveSettings(42).warnings).toHaveLength(1);
  });

  it('treats prototype-named keys as unknown instead of crashing', () => {
    expect(() => resolveSettings({ toString: 5, constructor: 1 })).not.toThrow();
    expect(resolveSettings({ toString: 5 }).warnings).toEqual(['Unknown setting "toString" ignored']);
    expect(resolveSettings(JSON.parse('{"__proto__": 3}')).warnings).toHaveLength(1);
  });

  it('deep-freezes DEFAULT_SETTINGS', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS.detection.weights)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.excludePatterns)).toBe(true);
    const { settings } = resolveSettings({});
    settings.detection.weights.emptyMount = 9;
    expect(DEFAULT_SETTINGS.detection.weights.emptyMount).toBe(0.3);
  });

  it('has runtime settings for rendering and streaming', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ renderConcurrency: 2, idleTimeoutMs: 30000, memoryBodyLimitBytes: 8388608 });
    const { settings, warnings } = resolveSettings({ renderConcurrency: 99, idleTimeoutMs: 10, memoryBodyLimitBytes: 1 });
    expect(settings.renderConcurrency).toBe(8);
    expect(settings.idleTimeoutMs).toBe(1000);
    expect(settings.memoryBodyLimitBytes).toBe(262144);
    expect(warnings).toHaveLength(3);
  });
});

describe('compileExcludePatterns', () => {
  it('compiles strings to RegExp', () => {
    const [re] = compileExcludePatterns(['logout']);
    expect(re!.test('https://x.com/logout')).toBe(true);
  });
});
