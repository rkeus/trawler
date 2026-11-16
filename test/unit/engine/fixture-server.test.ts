import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../../helpers/fixture-server';
import { cdnSite, staticSite } from '../../fixtures/static-site';

let cdn: FixtureServer;
let site: FixtureServer;
beforeAll(async () => {
  cdn = await startFixtureServer(() => cdnSite());
  site = await startFixtureServer(() => staticSite(cdn.url));
});
afterAll(async () => {
  await site.close();
  await cdn.close();
});

describe('fixture server', () => {
  it('serves routes, redirects, 404s and logs requests', async () => {
    const index = await fetch(`${site.url}/html/index.html`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain(`${cdn.url}/lib/cdn.css`);
    const css = await fetch(`${site.url}/html/assets/css/style.css?v=3`);
    expect(css.headers.get('content-type')).toBe('text/css');
    const old = await fetch(`${site.url}/html/old-page.html`);
    expect(old.url).toBe(`${site.url}/html/about.html`);
    expect((await fetch(`${site.url}/nope`)).status).toBe(404);
    expect(site.requests).toContain('/html/assets/css/style.css?v=3');
  });
});
