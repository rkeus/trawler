import { describe, it, expect } from 'vitest';
import { isFileInside } from '../../../src/main/ui-trust';

const DIR = 'C:\\Users\\FIRSTN~1\\App [x]\\out\\renderer';

describe('isFileInside', () => {
  it('accepts files in the folder, however the URL is encoded', () => {
    expect(isFileInside('file:///C:/Users/FIRSTN~1/App%20[x]/out/renderer/index.html', DIR)).toBe(true);
    expect(isFileInside('file:///C:/Users/FIRSTN%7E1/App%20%5Bx%5D/out/renderer/index.html', DIR)).toBe(true);
    expect(isFileInside('file:///c:/users/firstn~1/app%20[x]/OUT/renderer/index.html', DIR)).toBe(true);
    expect(isFileInside('file:///C:/Users/FIRSTN~1/App%20[x]/out/renderer/sub/page.html?a=1#b', DIR)).toBe(true);
  });

  it('accepts non-ASCII folder names', () => {
    const name = `${String.fromCodePoint(0x17d)}eljko`; // "Zeljko" with a caron on the Z
    expect(isFileInside(`file:///C:/Users/${encodeURIComponent(name)}/out/renderer/index.html`, `C:\\Users\\${name}\\out\\renderer`)).toBe(true);
  });

  it('rejects everything else', () => {
    for (const url of [
      'file:///C:/Users/FIRSTN~1/App%20[x]/out/renderer',
      'file:///C:/Users/FIRSTN~1/App%20[x]/out/main/index.html',
      'file:///C:/Users/FIRSTN~1/App%20[x]/out/renderer/../main/x.html',
      'file:///C:/Users/FIRSTN~1/App%20[x]/out/renderer-evil/index.html',
      'file://server/share/out/renderer/index.html',
      'http://localhost:5173/index.html',
      'about:blank',
      '',
      'not a url',
    ]) {
      expect(isFileInside(url, DIR), url).toBe(false);
    }
  });
});
