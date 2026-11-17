import { afterAll, afterEach } from 'vitest';
import { removeTmpDirs } from './helpers/tmp';

afterAll(removeTmpDirs);

// renderer tests (jsdom): unmount what a test rendered
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
