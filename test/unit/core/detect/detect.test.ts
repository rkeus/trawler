import { describe, it, expect } from 'vitest';
import { computeSignals, scoreSignals, verdictFor, explainSignals, detect } from '../../../../src/core/detect/detect';
import { DEFAULT_SETTINGS } from '../../../../src/shared/settings';

const OPTS = DEFAULT_SETTINGS.detection;

const STATIC_PAGE = `<html><head><link href="assets/css/bootstrap.min.css" rel="stylesheet"></head>
<body><h1>Tours</h1><p>Find the best tours and hotels for your next trip.</p></body></html>`;

const SPA_RAW = `<html><head></head><body><div id="root"></div>
<script type="module" src="/assets/index-AbCdEf12.js"></script></body></html>`;
const SPA_RENDERED = `<html><head></head><body><div id="root"><h1>Dashboard</h1><p>Welcome back, here are your stats.</p></div>
<script type="module" src="/assets/index-AbCdEf12.js"></script></body></html>`;

const NEXT_SSR = `<html><body><h1>Blog</h1><p>Server rendered content.</p>
<script id="__NEXT_DATA__" type="application/json">{}</script></body></html>`;

describe('computeSignals', () => {
  it('compares raw and rendered HTML', () => {
    const s = computeSignals(SPA_RAW, SPA_RENDERED, 2);
    expect(s.textRatio).toBe(0);
    expect(s.emptyMount).toBe(true);
    expect(s.mountIds).toEqual(['#root']);
    expect(s.frameworkMarkers).toEqual(['Vite']);
    expect(s.dataRequests).toBe(2);
    expect(s.moduleScripts).toBe(1);
  });
  it('uses ratio 1 when rendered page is empty', () => {
    expect(computeSignals('<body></body>', '<body></body>', 0).textRatio).toBe(1);
  });
});

describe('scoreSignals / verdictFor', () => {
  it('scores a static page as 0 → static', () => {
    const score = scoreSignals(computeSignals(STATIC_PAGE, STATIC_PAGE, 0), OPTS.weights);
    expect(score).toBe(0);
    expect(verdictFor(score, OPTS.thresholds)).toBe('static');
  });
  it('scores a Vite SPA high → js', () => {
    const score = scoreSignals(computeSignals(SPA_RAW, SPA_RENDERED, 2), OPTS.weights);
    expect(score).toBe(0.967);
    expect(verdictFor(score, OPTS.thresholds)).toBe('js');
  });
  it('scores an SSR framework page exactly at the hybrid threshold', () => {
    const score = scoreSignals(computeSignals(NEXT_SSR, NEXT_SSR, 0), OPTS.weights);
    expect(score).toBe(0.3);
    expect(verdictFor(score, OPTS.thresholds)).toBe('hybrid');
  });
  it('respects custom thresholds', () => {
    expect(verdictFor(0.5, { static: 0.1, js: 0.4 })).toBe('js');
  });
});

describe('explainSignals', () => {
  it('explains each signal in plain English', () => {
    const lines = explainSignals(computeSignals(SPA_RAW, SPA_RENDERED, 2));
    expect(lines).toContain('Empty mount point #root in the raw HTML: content is injected by JavaScript.');
    expect(lines).toContain('Raw HTML holds only 0% of the rendered text.');
    expect(lines).toContain('Framework markers found: Vite.');
    expect(lines).toContain('2 JSON data request(s) during render.');
    expect(lines).toContain('1 ES module script(s).');
  });
});

describe('detect', () => {
  it('returns a full Detection with UI kits', () => {
    const d = detect({ rawHtml: STATIC_PAGE, renderedHtml: STATIC_PAGE, dataRequests: 0 }, OPTS);
    expect(d.verdict).toBe('static');
    expect(d.uiKits).toEqual(['Bootstrap']);
    expect(d.frameworks).toEqual([]);
    expect(d.explanations.length).toBeGreaterThan(0);
  });
});
