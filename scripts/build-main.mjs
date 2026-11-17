import { build } from 'esbuild';
import fs from 'node:fs/promises';

const common = { bundle: true, format: 'cjs', external: ['electron'], sourcemap: true, logLevel: 'warning' };

// main process
await build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'out/main/index.cjs', platform: 'node', target: 'node22' });

// sandboxed preload: one self-contained file whose only require is "electron"
await build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'out/preload/index.cjs', platform: 'browser', target: 'es2022' });

// UI page (a placeholder until Plan 3b builds the React renderer)
await fs.mkdir('out/renderer', { recursive: true });
await fs.copyFile('src/renderer/index.html', 'out/renderer/index.html');
