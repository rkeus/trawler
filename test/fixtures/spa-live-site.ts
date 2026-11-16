import { PNG_1X1, type Routes } from '../helpers/fixture-server';

const SHELL =
  '<!doctype html><html><head><meta charset="utf-8"><title>Live app</title></head><body><div id="root"></div>' +
  '<script type="module" src="/app/assets/index-AbCdEf12.js"></script></body></html>';

const BUNDLE = `
const root = document.getElementById('root');
fetch('/app/api/items.json')
  .then((r) => r.json())
  .then((items) => {
    root.innerHTML =
      '<h1>Dashboard</h1><p>Welcome back, here are your latest numbers and reports.</p><ul>' +
      items.map((i) => '<li>Item ' + i + '</li>').join('') +
      '</ul><a href="/app/about">About</a><img src="/app/img/pic.png" alt="">';
  });
import('./chunk-1234abcd.js');
`;

/** A Vite-style SPA: empty mount point, module bundle, lazy chunk, JSON fetch, JS-inserted link and image. */
export function spaLiveSite(): Routes {
  return {
    '/app/': { type: 'text/html; charset=utf-8', body: SHELL },
    '/app/about': { type: 'text/html; charset=utf-8', body: SHELL },
    '/app/assets/index-AbCdEf12.js': { type: 'text/javascript', body: BUNDLE },
    '/app/assets/chunk-1234abcd.js': { type: 'text/javascript', body: 'export default 1;' },
    '/app/api/items.json': { type: 'application/json', body: '[1,2,3]' },
    '/app/img/pic.png': { type: 'image/png', body: PNG_1X1 },
  };
}
