import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The UI is built to out/renderer and loaded from file: by the main window (src/main/window.ts).
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: { outDir: '../../out/renderer', emptyOutDir: true, sourcemap: true, target: 'es2022' },
});
