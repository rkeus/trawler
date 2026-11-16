import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG_1X1, startFixtureServer, type FixtureServer } from '../../helpers/fixture-server';
import { fakeCapturer } from '../../helpers/fake-capturer';
import { makeTmpDir } from '../../helpers/tmp';
import { SPA_SHELL, spaRendered, spaSite } from '../../fixtures/spa-site';
import { runJob, type JobPorts, type JobRequest } from '../../../src/engine/job';
import type { Capturer, Fetcher, JobEvent } from '../../../src/engine/types';
import { resolveSettings } from '../../../src/shared/settings';

const STATIC_HTML = '<!doctype html><html><body><h1>Tours</h1><p>Find tours and hotels.</p><img src="i.png"></body></html>';

let site: FixtureServer;
beforeAll(async () => {
  site = await startFixtureServer(() => ({
    ...spaSite(),
    '/s/index.html': { type: 'text/html', body: STATIC_HTML },
    '/s/i.png': { type: 'image/png', body: PNG_1X1 },
  }));
});
afterAll(() => site.close());

const sameAsServed = (): Capturer =>
  fakeCapturer(() => ({ html: STATIC_HTML, renderedHtml: STATIC_HTML }));
const spaRender = () => fakeCapturer(() => ({ html: SPA_SHELL, renderedHtml: spaRendered(), dataRequests: 1 }));

async function go(req: Partial<JobRequest>, ports: Partial<JobPorts>) {
  const events: JobEvent[] = [];
  const result = await runJob(
    {
      kind: 'download',
      seedUrl: `${site.url}/s/index.html`,
      settings: resolveSettings({ retries: 0, respectRobotsTxt: false, verifyAfterDownload: false }).settings,
      ...req,
    },
    { fetchImpl: fetch, ...ports },
    { signal: new AbortController().signal, emit: (e) => events.push(e) },
  );
  return { result, events };
}

describe('runJob with a capturer', () => {
  it('detects a static site and mirrors it statically', async () => {
    const out = await makeTmpDir('jobjs');
    const cap = sameAsServed();
    const { result, events } = await go({ outputDir: out }, { capturer: cap });
    expect(result.status).toBe('done');
    expect(result.mode).toBe('static');
    expect(result.detection?.verdict).toBe('static');
    expect(events.find((e) => e.type === 'detection')).toBeDefined();
    expect(events.filter((e) => e.type === 'phase').map((e) => (e as { phase: string }).phase)).toEqual([
      'detecting',
      'crawling',
      'rewriting',
      'done',
    ]);
    const manifest = JSON.parse(await fs.readFile(path.join(out, '_trawler', 'manifest.json'), 'utf8'));
    expect(manifest.detection.verdict).toBe('static');
  });

  it('detects a SPA, switches to JS mode and reuses the start-page render', async () => {
    const out = await makeTmpDir('jobjs');
    const cap = spaRender();
    const { result } = await go({ outputDir: out, seedUrl: `${site.url}/app/` }, { capturer: cap });
    expect(result.mode).toBe('js');
    expect(result.detection?.verdict).toBe('js');
    expect(cap.calls.filter((u) => u === `${site.url}/app/`)).toHaveLength(1);
    await expect(fs.stat(path.join(out, 'index.html'))).resolves.toBeDefined();
  });

  it('still reports detection when analyzing with a fixed mode', async () => {
    const { result } = await go(
      { kind: 'analyze', outputDir: undefined, settings: resolveSettings({ mode: 'static', retries: 0, respectRobotsTxt: false }).settings },
      { capturer: sameAsServed() },
    );
    expect(result.mode).toBe('static');
    expect(result.detection?.verdict).toBe('static');
    expect(result.analysis?.detection?.verdict).toBe('static');
  });

  it('falls back to static mode with a warning when detection fails', async () => {
    const broken: Capturer = { capture: async () => Promise.reject(new Error('no gpu')) };
    const { result } = await go({ outputDir: await makeTmpDir('jobjs') }, { capturer: broken });
    expect(result.mode).toBe('static');
    expect(result.warnings.join(' ')).toContain('Architecture detection failed');
  });

  it('applies decorateFetcher', async () => {
    let decorated = 0;
    const decorateFetcher = (f: Fetcher): Fetcher => {
      decorated++;
      return f;
    };
    const { result } = await go({ outputDir: await makeTmpDir('jobjs') }, { decorateFetcher });
    expect(decorated).toBe(1);
    expect(result.status).toBe('done');
  });
});
