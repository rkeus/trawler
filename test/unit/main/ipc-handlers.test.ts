import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppStateStore } from '../../../src/main/app-state-store';
import { HistoryStore } from '../../../src/main/history-store';
import { createHandlers, invokeHandler, type AppServices } from '../../../src/main/ipc-handlers';
import { JobBusyError } from '../../../src/main/job-manager';
import { SettingsStore } from '../../../src/main/settings-store';
import { IPC, type StartJobRequest } from '../../../src/shared/ipc';
import { historyEntry } from '../../helpers/history-entry';
import { makeTmpDir } from '../../helpers/tmp';

async function setup(over: Partial<AppServices> = {}) {
  const dir = await makeTmpDir('ipc');
  const settings = new SettingsStore(SettingsStore.fileIn(dir));
  const history = new HistoryStore(HistoryStore.fileIn(dir));
  const appState = new AppStateStore(AppStateStore.fileIn(dir));
  await Promise.all([settings.load(), history.load(), appState.load()]);
  const opened: string[] = [];
  const started: StartJobRequest[] = [];
  const services: AppServices = {
    settings,
    history,
    appState,
    jobs: {
      start: (req) => {
        started.push(req);
        return { jobId: 'j1', settings: settings.get(), warnings: [], usesAnalysisCache: false };
      },
      cancel: (id) => id === 'j1',
      current: () => undefined,
    },
    preview: {
      start: async (outputDir) => ({ url: 'http://127.0.0.1:1234/html/', outputDir }),
      stop: async () => undefined,
      current: () => ({ url: 'http://127.0.0.1:1234/html/', outputDir: dir }),
    },
    info: { version: '0.0.0', userDataDir: dir },
    chooseFolder: async () => null,
    openPath: async (target) => {
      opened.push(target);
    },
    openExternal: async (url) => {
      opened.push(url);
    },
    ...over,
  };
  const handlers = createHandlers(services);
  const call = (name: string, ...args: unknown[]) => invokeHandler(handlers, name, args);
  return { dir, handlers, call, opened, started, history, appState };
}

describe('IPC handlers', () => {
  it('has exactly one handler per command', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual(Object.keys(IPC).sort());
  });

  it('rejects unknown commands, including prototype keys', async () => {
    const { call } = await setup();
    expect(await call('nope')).toEqual({ ok: false, error: 'Unknown command: nope' });
    expect(await call('constructor')).toEqual({ ok: false, error: 'Unknown command: constructor' });
  });

  it('wraps results and errors', async () => {
    const { call } = await setup({
      jobs: {
        start: () => {
          throw new JobBusyError();
        },
        cancel: () => false,
        current: () => undefined,
      },
    });
    expect(await call('appInfo')).toEqual({ ok: true, value: expect.objectContaining({ version: '0.0.0' }) });
    const busy = await call('startJob', { kind: 'analyze', seedUrl: 'https://example.com/' });
    expect(busy).toEqual({ ok: false, error: expect.stringMatching(/already running/) });
  });

  it('validates a job request before starting it', async () => {
    const { call, started } = await setup();
    for (const bad of [
      undefined,
      { kind: 'analyze' },
      { kind: 'steal', seedUrl: 'https://example.com/' },
      { kind: 'download', seedUrl: 'https://example.com/', outputDir: 'relative/dir' },
      { kind: 'download', seedUrl: 'https://example.com/', outputDir: path.resolve('x'), folderPolicy: 'delete' },
    ]) {
      expect((await call('startJob', bad)).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(started).toEqual([]);
  });

  it('starts a valid job and remembers its output folder', async () => {
    const { call, started, appState } = await setup();
    const out = path.resolve(await makeTmpDir('ipc-out'));
    const reply = await call('startJob', {
      kind: 'download',
      seedUrl: 'https://example.com/',
      outputDir: out,
      folderPolicy: 'merge',
      settings: { maxPages: 3 },
    });
    expect(reply).toMatchObject({ ok: true, value: { jobId: 'j1' } });
    expect(started).toEqual([
      { kind: 'download', seedUrl: 'https://example.com/', outputDir: out, folderPolicy: 'merge', settings: { maxPages: 3 } },
    ]);
    expect(appState.get().lastOutputDir).toBe(out);
  });

  it('opens only existing folders', async () => {
    const { call, opened, dir } = await setup();
    const file = path.join(dir, 'a.txt');
    await fs.writeFile(file, 'x');
    expect((await call('openFolder', path.join(dir, 'missing'))).ok).toBe(false);
    expect((await call('openFolder', file)).ok).toBe(false);
    expect((await call('openFolder', 'relative')).ok).toBe(false);
    expect(opened).toEqual([]);
    expect(await call('openFolder', dir)).toEqual({ ok: true, value: null });
    expect(opened).toEqual([path.resolve(dir)]);
  });

  it('opens the report only when the folder has one', async () => {
    const { call, opened, dir } = await setup();
    expect((await call('openReport', dir)).ok).toBe(false);
    await fs.mkdir(path.join(dir, '_trawler'), { recursive: true });
    await fs.writeFile(path.join(dir, '_trawler', 'report.json'), '{}');
    expect((await call('openReport', dir)).ok).toBe(true);
    expect(opened).toEqual([path.join(path.resolve(dir), '_trawler', 'report.json')]);
  });

  it('opens only the running preview in the browser', async () => {
    const running = await setup();
    expect(await running.call('openPreview')).toEqual({ ok: true, value: null });
    expect(running.opened).toEqual(['http://127.0.0.1:1234/html/']);
    const idle = await setup({
      preview: { start: async () => ({ url: '', outputDir: '' }), stop: async () => undefined, current: () => undefined },
    });
    expect(await idle.call('openPreview')).toEqual({ ok: false, error: 'No preview is running.' });
  });

  it('applies a smaller history size right away', async () => {
    const { call, history } = await setup();
    for (const id of ['1', '2', '3']) await history.add(historyEntry(id), 20);
    const reply = await call('updateSettings', { historySize: 1 });
    expect(reply.ok).toBe(true);
    expect(history.list().map((e) => e.id)).toEqual(['3']);
  });

  it('inspects folders and validates the path', async () => {
    const { call, dir } = await setup();
    expect(await call('inspectFolder', path.join(dir, 'new'))).toEqual({ ok: true, value: 'missing' });
    expect((await call('inspectFolder', 42)).ok).toBe(false);
  });

  it('returns null for "no running job" and "dialog cancelled"', async () => {
    const { call } = await setup();
    expect(await call('currentJob')).toEqual({ ok: true, value: null });
    expect(await call('chooseFolder')).toEqual({ ok: true, value: null });
  });

  it('rejects network and device paths', async () => {
    const { call, opened } = await setup();
    for (const p of ['\\\\host\\share', '//host/share', '\\\\?\\C:\\Windows']) {
      expect(await call('openFolder', p)).toEqual({ ok: false, error: 'dir: network and device paths are not supported' });
      expect((await call('inspectFolder', p)).ok).toBe(false);
    }
    expect(opened).toEqual([]);
  });
});
