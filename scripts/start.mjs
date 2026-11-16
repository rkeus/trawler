import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // set by VS Code-based terminals; it would make Electron run as plain Node
// Electron aborts at startup (exit -1, no output) when a bare URL argument is followed by more arguments, so --url is passed as --url=<value>
const args = process.argv.slice(2).flatMap((a, i, all) => (all[i - 1] === '--url' ? [] : a === '--url' && all[i + 1] !== undefined ? [`--url=${all[i + 1]}`] : [a]));
const child = spawn(electron, ['.', ...args], { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code ?? 1));
