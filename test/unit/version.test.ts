import fs from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import { TRAWLER_VERSION } from '../../src/engine';

describe('version', () => {
  it('is the same in the engine and in package.json', async () => {
    const pkg = JSON.parse(await fs.readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(TRAWLER_VERSION).toBe(pkg.version);
  });
});
