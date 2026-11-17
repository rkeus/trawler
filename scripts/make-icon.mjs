import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Renders build/icon.svg to build/icon.png with Electron's own Chromium. Run `npm run make-icon` after changing the logo.
const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // set by VS Code-based terminals; it would make Electron run as plain Node
const child = spawn(electron, ['scripts/icon-main.cjs'], { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code ?? 1));
