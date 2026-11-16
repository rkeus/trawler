import { describe, it, expect } from 'vitest';
import { cleanUserAgent } from '../../../src/main/user-agent';

describe('cleanUserAgent', () => {
  it('removes the Electron and app tokens', () => {
    expect(
      cleanUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Trawler/0.1.0 Chrome/156.0.8078.100 Electron/45.3.3 Safari/537.36',
      ),
    ).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.100 Safari/537.36');
  });
  it('leaves a plain Chromium user agent alone', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
    expect(cleanUserAgent(ua)).toBe(ua);
  });
});
