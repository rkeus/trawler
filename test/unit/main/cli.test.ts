import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../../../src/main/cli';

const base = ['C:\\electron\\electron.exe', '.', '--trawler-cli'];

describe('parseCliArgs', () => {
  it('returns app mode without the CLI flag', () => {
    expect(parseCliArgs(['electron.exe', '.'])).toEqual({ kind: 'app' });
  });

  it('parses a download with all options, both flag styles', () => {
    expect(
      parseCliArgs([...base, '--url', 'https://x.com/', '--out=D:\\out', '--mode', 'js', '--policy=merge', '--settings', '{"retries":0}']),
    ).toEqual({
      kind: 'cli',
      args: { kind: 'download', url: 'https://x.com/', out: 'D:\\out', mode: 'js', policy: 'merge', settings: { retries: 0 } },
    });
  });

  it('parses an analyze without an output folder', () => {
    expect(parseCliArgs([...base, '--kind', 'analyze', '--url', 'https://x.com/'])).toEqual({
      kind: 'cli',
      args: { kind: 'analyze', url: 'https://x.com/' },
    });
  });

  it('ignores Chromium and Electron switches', () => {
    const r = parseCliArgs([...base, '--no-sandbox', '--inspect=9229', '--url', 'https://x.com/', '--out', 'o']);
    expect(r.kind).toBe('cli');
  });

  it('reports usage errors', () => {
    const msg = (argv: string[]) => {
      const r = parseCliArgs([...base, ...argv]);
      return r.kind === 'error' ? r.message : '';
    };
    expect(msg([])).toContain('--url is required');
    expect(msg(['--url', 'https://x.com/'])).toContain('--out is required');
    expect(msg(['--url', 'https://x.com/', '--out', 'o', '--kind', 'mirror'])).toContain('--kind');
    expect(msg(['--url', 'https://x.com/', '--out', 'o', '--mode', 'fast'])).toContain('--mode');
    expect(msg(['--url', 'https://x.com/', '--out', 'o', '--policy', 'ask'])).toContain('--policy');
    expect(msg(['--url', 'https://x.com/', '--out', 'o', '--settings', '{bad'])).toContain('--settings');
    expect(msg(['--url', 'https://x.com/', '--out', 'o', '--settings', '[1]'])).toContain('--settings');
    expect(msg(['--url', '--out', 'o'])).toContain('--url needs a value');
    expect(msg([])).toContain('Usage:');
  });
});
