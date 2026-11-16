import { build } from 'esbuild';

await build({
  entryPoints: ['src/main/index.ts'],
  outfile: 'out/main/index.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
});
