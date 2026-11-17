import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts', 'test/renderer/**/*.test.tsx'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
  },
});
