import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // set by VS Code-based terminals; it would make Electron run as plain Node
// "--" first: on Windows, Electron refuses to start when a URL argument is followed by more arguments
// (its CVE-2018-1000006 guard), unless a "--" comes before it
const child = spawn(electron, ['.', '--', ...process.argv.slice(2)], { stdio: 'inherit', env });
// Ctrl+C also reaches the child: let it cancel the job and exit with its own code
process.on('SIGINT', () => undefined);
child.on('close', (code) => process.exit(code ?? 1));
