import { runJob, type JobEvent } from '../engine';
import { resolveSettings } from '../shared/settings';
import type { CliArgs } from './cli';
import { createElectronPorts } from './ports';

export const RESULT_PREFIX = 'TRAWLER_RESULT ';

const writeLine = (stream: NodeJS.WriteStream, line: string): Promise<void> =>
  new Promise((resolve) => stream.write(`${line}\n`, () => resolve()));

/**
 * Runs one job headlessly. Progress events go to stderr as JSON lines; the final JobResult goes to stdout on one
 * line prefixed with "TRAWLER_RESULT ". Exit code: 0 done / done_with_errors, 1 failed, 2 cancelled.
 */
export async function runCli(args: CliArgs): Promise<number> {
  const { settings, warnings } = resolveSettings({ ...(args.settings ?? {}), ...(args.mode ? { mode: args.mode } : {}) });
  for (const w of warnings) await writeLine(process.stderr, `warning: ${w}`);

  const electron = createElectronPorts(settings);
  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort());
  try {
    const result = await runJob(
      {
        kind: args.kind,
        seedUrl: args.url,
        ...(args.out ? { outputDir: args.out } : {}),
        settings,
        ...(args.policy ? { folderPolicy: args.policy } : {}),
      },
      electron.ports,
      { signal: abort.signal, emit: (event: JobEvent) => void process.stderr.write(`${JSON.stringify(event)}\n`) },
    );
    await writeLine(process.stdout, `${RESULT_PREFIX}${JSON.stringify(result)}`);
    return result.status === 'failed' ? 1 : result.status === 'cancelled' ? 2 : 0;
  } finally {
    await electron.dispose();
  }
}
