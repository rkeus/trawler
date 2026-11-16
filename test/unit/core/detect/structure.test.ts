import { describe, it, expect } from 'vitest';
import { analyzeStructure } from '../../../../src/core/detect/structure';
import { findFrameworkMarkers, findUiKits } from '../../../../src/core/detect/markers';

describe('analyzeStructure', () => {
  it('counts visible text and body elements', () => {
    const s = analyzeStructure('<html><head><title>T</title></head><body><div><p>Hi</p></div></body></html>');
    expect(s.textLength).toBe(2);
    expect(s.elementCount).toBe(2);
    expect(s.emptyMountIds).toEqual([]);
  });

  it('ignores script, style, noscript and template text', () => {
    const s = analyzeStructure(
      '<body><script>var a="long text"</script><style>p{}</style><noscript>x</noscript><template>y</template><p>Hi</p></body>',
    );
    expect(s.textLength).toBe(2);
  });

  it('detects empty mount points and module scripts', () => {
    const s = analyzeStructure('<body><div id="root"></div><script type="module" src="/assets/index-AbCdEf12.js"></script></body>');
    expect(s.emptyMountIds).toEqual(['#root']);
    expect(s.moduleScripts).toBe(1);
    expect(s.textLength).toBe(0);
  });

  it('does not flag a filled mount point', () => {
    expect(analyzeStructure('<body><div id="app"><h1>Hello</h1></div></body>').emptyMountIds).toEqual([]);
  });
});

describe('markers', () => {
  it('finds framework markers', () => {
    expect(findFrameworkMarkers('<script id="__NEXT_DATA__">{}</script>')).toEqual(['Next.js']);
    expect(findFrameworkMarkers('<script src="/_nuxt/app.js"></script>')).toEqual(['Nuxt']);
    expect(findFrameworkMarkers('<app-root ng-version="17.0.0"></app-root>')).toEqual(['Angular']);
    expect(findFrameworkMarkers('<div data-v-1a2b3c4d class="x"></div>')).toEqual(['Vue']);
    expect(findFrameworkMarkers('<div data-reactroot=""></div>')).toEqual(['React']);
    expect(findFrameworkMarkers('<script type="module" src="/assets/index-AbCdEf12.js"></script>')).toEqual(['Vite']);
    expect(findFrameworkMarkers('<script>self.webpackChunkapp=[]</script>')).toEqual(['Webpack']);
    expect(findFrameworkMarkers('<p>plain</p>')).toEqual([]);
  });

  it('finds UI kits', () => {
    expect(
      findUiKits('<link href="assets/css/bootstrap.min.css"><script src="assets/js/jquery-3.7.1.min.js"></script>'),
    ).toEqual(['Bootstrap', 'jQuery']);
    expect(findUiKits('<script src="https://cdn.tailwindcss.com"></script>')).toEqual(['Tailwind CSS']);
  });
});
