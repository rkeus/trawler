import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELECTRON = createRequire(import.meta.url)('electron') as string;
const PREFIX = 'TRAWLER_RESULT ';

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
  /** parsed JobResult, when the run printed one */
  result: any;
}

/**
 * Spawns the real Electron binary on the built main bundle in CLI mode. Run `npm run build:main` first.
 * "--" precedes the arguments (Electron's URL-argument guard on Windows); ELECTRON_RUN_AS_NODE is removed.
 */
export function runCli(args: string[], timeoutMs = 150000): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(ELECTRON, ['.', '--', '--trawler-cli', ...args], { cwd: ROOT, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out\n${stderr}`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).find((l) => l.startsWith(PREFIX));
      resolve({ code: code ?? -1, stdout, stderr, result: line ? JSON.parse(line.slice(PREFIX.length)) : undefined });
    });
  });
}
