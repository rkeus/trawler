import { PNG_1X1, type Routes } from '../helpers/fixture-server';

/** Served SPA shell: empty mount point + module bundle (Vite-style name). */
export const SPA_SHELL =
  '<!doctype html><html><head><meta charset="utf-8"><title>App</title></head><body><div id="root"></div>' +
  '<script type="module" src="/app/assets/index-AbCdEf12.js"></script></body></html>';

/** What a browser would show after the bundle ran. */
export function spaRendered(): string {
  return SPA_SHELL.replace(
    '<div id="root"></div>',
    '<div id="root"><h1>Dashboard</h1><p>Welcome back, here are your latest numbers and reports.</p>' +
      '<a href="/app/about">About</a><img src="/app/img/lazy.png" loading="lazy"></div>',
  );
}

export function spaSite(): Routes {
  return {
    '/app/': { type: 'text/html; charset=utf-8', body: SPA_SHELL },
    '/app/about': { type: 'text/html; charset=utf-8', body: SPA_SHELL },
    '/app/report': { type: 'application/pdf', body: Buffer.from('%PDF-1.4 fake report') },
    '/app/assets/index-AbCdEf12.js': { type: 'text/javascript', body: 'import("./chunk-1234abcd.js");' },
    '/app/assets/chunk-1234abcd.js': { type: 'text/javascript', body: 'export default 1;' },
    '/app/api/items.json': { type: 'application/json', body: '[1,2,3]' },
    '/app/img/lazy.png': { type: 'image/png', body: PNG_1X1 },
  };
}
