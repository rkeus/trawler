import fs from 'node:fs/promises';
import { describe, it, expect } from 'vitest';

describe('app icon', () => {
  it('is a 512x512 PNG', async () => {
    const png = await fs.readFile(new URL('../../build/icon.png', import.meta.url));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    // IHDR: width and height are big-endian 32-bit integers at bytes 16 and 20
    expect(png.readUInt32BE(16)).toBe(512);
    expect(png.readUInt32BE(20)).toBe(512);
  });
});
