// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/renderer/App';
import { fakeApi } from '../helpers/fake-api';
import { historyEntry } from '../helpers/history-entry';
import { analysisResult } from '../helpers/analysis';
import type { JobResult } from '../../src/engine';
import type { JobFinishedMessage } from '../../src/shared/ipc';

async function open(setup?: (f: ReturnType<typeof fakeApi>) => void) {
  const fake = fakeApi();
  setup?.(fake);
  render(<App api={fake.api} />);
  await screen.findByRole('button', { name: 'Analyze' }).catch(() => undefined);
  return { fake, user: userEvent.setup() };
}

describe('Start screen', () => {
  it('shows the welcome steps while there is no history', async () => {
    await open();
    expect(await screen.findByText('Paste a link')).toBeTruthy();
    expect(screen.getByText('Cast a URL. Haul back the whole template.')).toBeTruthy();
  });

  it('asks to accept the legal note, once', async () => {
    const { fake, user } = await open((f) => f.api.getAppState.mockResolvedValue({ legalNoteAccepted: false, theme: 'dark', palette: 'ember' }));
    await user.click(await screen.findByRole('button', { name: 'Got it' }));
    expect(fake.api.updateAppState).toHaveBeenCalledWith({ legalNoteAccepted: true });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull());
  });

  it('shows an error for an empty URL and starts nothing', async () => {
    const { fake, user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Analyze' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the template URL.');
    expect(fake.api.startJob).not.toHaveBeenCalled();
  });

  it('starts an analysis with the form values', async () => {
    const { fake, user } = await open();
    await user.type(await screen.findByLabelText('Template URL'), 'example.com/template/');
    await user.click(screen.getByRole('radio', { name: 'JS' }));
    await user.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(fake.api.startJob).toHaveBeenCalledWith({
      kind: 'analyze',
      seedUrl: 'https://example.com/template/',
      settings: { mode: 'js', downloadExternal: true },
    });
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy(); // the progress screen
  });

  it('asks what to do when the output folder is not empty', async () => {
    const { fake, user } = await open((f) => {
      f.api.chooseFolder.mockResolvedValue('D:\\out');
      f.api.inspectFolder.mockResolvedValue('non-empty');
    });
    await user.type(await screen.findByLabelText('Template URL'), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Choose output folder' }));
    await screen.findByText('D:\\out');
    await user.click(screen.getByRole('button', { name: 'Download' }));
    const dialog = await screen.findByRole('dialog');
    expect(fake.api.startJob).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    expect(fake.api.startJob).toHaveBeenCalledWith({
      kind: 'download',
      seedUrl: 'https://example.com/',
      outputDir: 'D:\\out',
      folderPolicy: 'merge',
      settings: { mode: 'auto', downloadExternal: true },
    });
  });

  it('repeats an earlier job with its stored settings', async () => {
    const entry = historyEntry('h1');
    const { fake, user } = await open((f) => f.api.listHistory.mockResolvedValue([entry]));
    const row = (await screen.findByText('example.com')).closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Repeat' }));
    expect(fake.api.startJob).toHaveBeenCalledTimes(1);
    const sent = fake.api.startJob.mock.calls[0]![0];
    expect(sent).toMatchObject({ kind: 'analyze', seedUrl: 'https://example.com/' });
    expect(sent.settings).toMatchObject({ maxPages: entry.settings.maxPages });
  });

  it('removes a history entry', async () => {
    const { fake, user } = await open((f) => f.api.listHistory.mockResolvedValue([historyEntry('h1')]));
    const row = (await screen.findByText('example.com')).closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Remove' }));
    expect(fake.api.removeHistory).toHaveBeenCalledWith('h1');
  });
});

describe('Progress screen', () => {
  const ZERO = { pagesDone: 0, pagesQueued: 0, assetsDone: 0, assetsQueued: 0, bytes: 0, errors: 0 };

  async function startAnalysis() {
    const ctx = await open();
    await ctx.user.type(await screen.findByLabelText('Template URL'), 'example.com/template/');
    await ctx.user.click(screen.getByRole('button', { name: 'Analyze' }));
    await screen.findByRole('button', { name: 'Cancel' });
    return ctx;
  }

  it('follows a running job and shows how it ended', async () => {
    const { fake, user } = await startAnalysis();
    act(() => {
      fake.emitEvent({ jobId: 'job-1', event: { type: 'phase', phase: 'crawling' } });
      fake.emitEvent({ jobId: 'job-1', event: { type: 'progress', counters: { ...ZERO, pagesDone: 2, pagesQueued: 4, assetsDone: 7, bytes: 2048, errors: 1 } } });
      fake.emitEvent({ jobId: 'job-1', event: { type: 'log', level: 'error', message: 'HTTP 404', url: 'https://example.com/missing.png' } });
    });
    expect(await screen.findByText('2 / 4')).toBeTruthy();
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Errors (1)' }));
    expect(screen.getByText(/HTTP 404/)).toBeTruthy();

    act(() => {
      fake.emitFinished({
        jobId: 'job-1',
        result: { kind: 'analyze', status: 'done', mode: 'static', counters: { ...ZERO, pagesDone: 4, pagesQueued: 4 }, warnings: ['robots.txt disallows /admin/'] },
      });
    });
    expect(await screen.findByRole('heading', { name: 'Done' })).toBeTruthy();
    expect(screen.getByText('robots.txt disallows /admin/')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to start' }));
    expect(await screen.findByRole('button', { name: 'Analyze' })).toBeTruthy();
  });

  it('cancels the running job', async () => {
    const { fake, user } = await startAnalysis();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fake.api.cancelJob).toHaveBeenCalledWith('job-1');
  });

  it('shows a failure with its message', async () => {
    const { fake } = await startAnalysis();
    act(() => {
      fake.emitFinished({ jobId: 'job-1', result: { kind: 'analyze', status: 'failed', mode: 'static', counters: ZERO, warnings: [], error: 'HTTP 404' } });
    });
    expect(await screen.findByRole('heading', { name: 'Failed' })).toBeTruthy();
    expect(screen.getByText('HTTP 404')).toBeTruthy();
  });

  it('reconnects to a job that is already running', async () => {
    const { fake } = await open((f) =>
      f.api.currentJob.mockResolvedValue({ jobId: 'job-7', kind: 'download', seedUrl: 'https://a.test/x/', startedAt: 's', phase: 'rewriting', counters: { ...ZERO, pagesDone: 3, pagesQueued: 3 } }),
    );
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(fake.api.currentJob).toHaveBeenCalled();
  });
});

describe('Settings screen', () => {
  async function openSettings() {
    const ctx = await open();
    await ctx.user.click(await screen.findByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });
    return ctx;
  }

  it('saves only the changed values', async () => {
    const { fake, user } = await openSettings();
    const depth = screen.getByLabelText('Max depth');
    await user.clear(depth);
    await user.type(depth, '7');
    await user.click(screen.getByRole('switch', { name: 'Respect robots.txt' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(fake.api.updateSettings).toHaveBeenCalledWith({ maxDepth: 7, respectRobotsTxt: false });
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('keeps Save off until something changed', async () => {
    const { user } = await openSettings();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(screen.getByLabelText('Max depth'), '1');
    expect(save.disabled).toBe(false);
  });

  it('shows a bad value next to its field and saves nothing', async () => {
    const { fake, user } = await openSettings();
    const pages = screen.getByLabelText('Max pages');
    await user.clear(pages);
    await user.type(pages, 'many');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a whole number.')).toBeTruthy();
    expect(fake.api.updateSettings).not.toHaveBeenCalled();
  });

  it('shows the warnings of the main process after a save', async () => {
    const { fake, user } = await openSettings();
    fake.api.updateSettings.mockResolvedValueOnce({ settings: fake.settings, defaults: fake.settings, warnings: ['maxPages: 0 out of range [1, 100000]; clamped to 1'] });
    await user.type(screen.getByLabelText('Max pages'), '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/clamped to 1/)).toBeTruthy();
  });

  it('resets to the defaults', async () => {
    const { fake, user } = await openSettings();
    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(fake.api.resetSettings).toHaveBeenCalled();
  });

  it('changes the theme and the accent at once', async () => {
    const { fake, user } = await openSettings();
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(fake.api.updateAppState).toHaveBeenCalledWith({ theme: 'light' });
    await user.click(screen.getByRole('button', { name: 'Moss' }));
    expect(fake.api.updateAppState).toHaveBeenCalledWith({ palette: 'moss' });
    await waitFor(() => expect(document.documentElement.dataset.palette).toBe('moss'));
  });
});

describe('Analysis screen', () => {
  async function openAnalysis(setup?: (f: ReturnType<typeof fakeApi>) => void) {
    return open((f) => {
      f.api.lastFinishedJob.mockResolvedValue({ jobId: 'a1', result: analysisResult() });
      setup?.(f);
    });
  }

  it('shows the verdict, the numbers, the reasons and the warnings', async () => {
    await openAnalysis();
    expect(await screen.findByText('HYBRID')).toBeTruthy();
    expect(screen.getByText('0.30')).toBeTruthy();
    expect(screen.getByText('Framework markers found (React).')).toBeTruthy();
    expect(screen.getByText('robots.txt disallows /admin/')).toBeTruthy();
    expect(screen.getByText('cdn.example')).toBeTruthy();
    expect(screen.getByText('https://example.com/template/about.html')).toBeTruthy();
  });

  it('applies the recommended settings to the form and marks them', async () => {
    await openAnalysis();
    expect(((await screen.findByLabelText(/^Mode/)) as HTMLSelectElement).value).toBe('js');
    expect((screen.getByLabelText(/^Max pages/) as HTMLInputElement).value).toBe('1000');
    expect(screen.getAllByText('recommended')).toHaveLength(2);
  });

  it('filters the page list', async () => {
    const { user } = await openAnalysis();
    await user.type(await screen.findByLabelText('Filter pages'), 'blog');
    expect(screen.queryByText('https://example.com/template/about.html')).toBeNull();
    expect(screen.getByText('https://example.com/template/blog/post-1.html')).toBeTruthy();
  });

  it('asks for a folder before downloading', async () => {
    const { fake, user } = await openAnalysis();
    await user.click(await screen.findByRole('button', { name: 'Download with these settings' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Choose an output folder first.');
    expect(fake.api.startJob).not.toHaveBeenCalled();
  });

  it('starts the download with the edited settings in the chosen folder', async () => {
    const { fake, user } = await openAnalysis((f) => f.api.chooseFolder.mockResolvedValue('D:\\out'));
    await user.click(await screen.findByRole('button', { name: 'Choose output folder' }));
    await screen.findByText('D:\\out');
    const depth = screen.getByLabelText(/^Max depth/);
    await user.clear(depth);
    await user.type(depth, '3');
    await user.click(screen.getByRole('button', { name: 'Download with these settings' }));
    expect(fake.api.startJob).toHaveBeenCalledWith({
      kind: 'download',
      seedUrl: 'https://example.com/template/index.html',
      outputDir: 'D:\\out',
      settings: { mode: 'js', downloadExternal: true, maxDepth: 3, maxPages: 1000, concurrency: 6, requestDelayMs: 0 },
    });
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('offers the last used folder and goes back to the start screen', async () => {
    const { user } = await openAnalysis((f) => f.api.getAppState.mockResolvedValue({ legalNoteAccepted: true, theme: 'dark', palette: 'ember', lastOutputDir: 'D:\\last' }));
    expect(await screen.findByText('D:\\last')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: 'Analyze' })).toBeTruthy();
  });

  it('shows no verdict when the mode was chosen by hand', async () => {
    await open((f) => {
      const result = analysisResult();
      delete result.analysis!.detection;
      delete result.detection;
      f.api.lastFinishedJob.mockResolvedValue({ jobId: 'a1', result });
    });
    expect(await screen.findByRole('button', { name: 'Download with these settings' })).toBeTruthy();
    expect(screen.queryByText('HYBRID')).toBeNull();
  });
});

describe('Done screen', () => {
  const download = (over: Partial<JobResult> = {}): JobFinishedMessage => ({
    jobId: 'd1',
    result: {
      kind: 'download',
      status: 'done',
      mode: 'js',
      outputDir: 'D:\\out\\site',
      counters: { pagesDone: 111, pagesQueued: 111, assetsDone: 482, assetsQueued: 482, bytes: 40265318, errors: 0 },
      verify: { pagesChecked: 111, pagesOk: 111, missing: [] },
      warnings: [],
      ...over,
    },
  });

  async function openDone(over: Partial<JobResult> = {}) {
    return open((f) => f.api.lastFinishedJob.mockResolvedValue(download(over)));
  }

  it('summarizes a finished download', async () => {
    await openDone();
    expect(await screen.findByRole('heading', { name: 'Done' })).toBeTruthy();
    expect(screen.getByText(/111\/111 pages verified, 0 missing files/)).toBeTruthy();
    expect(screen.getByText('38 MB')).toBeTruthy();
    expect(screen.getByText('D:\\out\\site')).toBeTruthy();
  });

  it('runs the preview, opens the folder and the report', async () => {
    const { fake, user } = await openDone();
    await user.click(await screen.findByRole('button', { name: 'Run preview' }));
    expect(fake.api.startPreview).toHaveBeenCalledWith('D:\\out\\site');
    await waitFor(() => expect(fake.api.openPreview).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(fake.api.openFolder).toHaveBeenCalledWith('D:\\out\\site');
    await user.click(screen.getByRole('button', { name: 'Open report' }));
    expect(fake.api.openReport).toHaveBeenCalledWith('D:\\out\\site');
  });

  it('shows the error of a failed action', async () => {
    const { fake, user } = await openDone();
    fake.api.openReport.mockRejectedValueOnce(new Error('This folder has no Trawler report.'));
    await user.click(await screen.findByRole('button', { name: 'Open report' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This folder has no Trawler report.');
  });

  it('lists the missing files of the verification', async () => {
    await openDone({
      status: 'done_with_errors',
      verify: { pagesChecked: 10, pagesOk: 9, missing: [{ page: 'index.html', url: 'https://example.com/a.png', status: 404 }] },
    });
    expect(await screen.findByRole('heading', { name: 'Done with errors' })).toBeTruthy();
    expect(screen.getByText(/index\.html/)).toBeTruthy();
    expect(screen.getByText(/https:\/\/example\.com\/a\.png \(HTTP 404\)/)).toBeTruthy();
  });

  it('lists the errors of the job that just ended', async () => {
    const { fake, user } = await open();
    await user.type(await screen.findByLabelText('Template URL'), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Analyze' }));
    await screen.findByRole('button', { name: 'Cancel' }); // job-1 runs
    act(() => {
      fake.emitEvent({ jobId: 'job-1', event: { type: 'log', level: 'error', message: 'HTTP 404', url: 'https://example.com/missing.png' } });
      fake.emitFinished({ ...download({ status: 'done_with_errors' }), jobId: 'job-1' });
    });
    expect(await screen.findByRole('heading', { name: 'Done with errors' })).toBeTruthy();
    expect(screen.getByText(/HTTP 404 https:\/\/example\.com\/missing\.png/)).toBeTruthy();
  });

  it('starts over with New download', async () => {
    const { user } = await openDone();
    await user.click(await screen.findByRole('button', { name: 'New download' }));
    expect(await screen.findByRole('button', { name: 'Analyze' })).toBeTruthy();
  });
});

describe('Startup warnings', () => {
  it('shows what the stores reported at start, until dismissed', async () => {
    const { user } = await open((f) =>
      f.api.appInfo.mockResolvedValue({ version: '0.1.0', userDataDir: 'C:\data', startupWarnings: ['history.json was damaged and was moved to history.json.corrupt-1; using defaults'] }),
    );
    expect(await screen.findByText(/history\.json was damaged/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/history\.json was damaged/)).toBeNull();
  });
});
