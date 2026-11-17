import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/packaged/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    testTimeout: 180000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
