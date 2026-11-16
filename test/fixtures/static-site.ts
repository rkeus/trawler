import { PNG_1X1, type Routes } from '../helpers/fixture-server';

const HTML = 'text/html; charset=utf-8';
const CSS = 'text/css';

/** CDN stand-in on its own origin. */
export function cdnSite(): Routes {
  return {
    '/lib/cdn.css': { type: CSS, body: '.cdn{background:url(cdn.png)}' },
    '/lib/cdn.png': { type: 'image/png', body: PNG_1X1 },
  };
}

/**
 * A static multi-page template under /html/ with:
 * - icon fonts via CSS and nested @import
 * - srcset and a lazy data-bg
 * - query-string assets and a server page (.php) served as HTML
 * - an asset above the base path, a CDN stylesheet, a redirect, a robots.txt-disallowed page and a 404 image
 */
export function staticSite(cdnOrigin: string): Routes {
  return {
    '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /html/private/\n' },
    '/html/index.html': {
      type: HTML,
      body: `<!doctype html><html><head><meta charset="utf-8"><title>Home</title>
<link rel="stylesheet" href="assets/css/style.css?v=3">
<link rel="stylesheet" href="/assets/shared/common.css">
<link rel="stylesheet" href="${cdnOrigin}/lib/cdn.css">
<script src="assets/js/app.js"></script>
</head><body>
<a href="about.html">About</a> <a href="blog/">Blog</a> <a href="contact.php">Contact</a>
<a href="private/secret.html">Secret</a> <a href="old-page.html">Old</a> <a href="https://elsewhere.example/">Out</a>
<img src="assets/img/logo.png" srcset="assets/img/logo.png 1x, assets/img/logo@2x.png 2x">
<div data-bg="assets/img/lazy.png"></div>
<img src="assets/img/missing.png">
</body></html>`,
    },
    '/html/about.html': {
      type: HTML,
      body: '<!doctype html><html><head><title>About</title></head><body><a href="index.html">Home</a><img src="assets/img/logo.png"></body></html>',
    },
    '/html/blog/': {
      type: HTML,
      body: '<!doctype html><html><head><title>Blog</title></head><body><a href="../index.html">Home</a><img src="../assets/img/logo.png"></body></html>',
    },
    '/html/contact.php': { type: HTML, body: '<!doctype html><html><body><p>Contact</p></body></html>' },
    '/html/old-page.html': { location: '/html/about.html' },
    '/html/private/secret.html': { type: HTML, body: '<p>secret</p>' },
    '/html/assets/css/style.css': {
      type: CSS,
      body: '@import "theme.css";\n@font-face{font-family:i;src:url(../fonts/icons.woff2?v=1) format("woff2")}\n.bg{background:url(../img/bg.png)}',
    },
    '/html/assets/css/theme.css': { type: CSS, body: '.t{color:red}' },
    '/assets/shared/common.css': { type: CSS, body: '.c{background:url(/assets/shared/pattern.png)}' },
    '/assets/shared/pattern.png': { type: 'image/png', body: PNG_1X1 },
    '/html/assets/js/app.js': { type: 'text/javascript', body: 'console.log("app");' },
    '/html/assets/img/logo.png': { type: 'image/png', body: PNG_1X1 },
    '/html/assets/img/logo@2x.png': { type: 'image/png', body: PNG_1X1 },
    '/html/assets/img/bg.png': { type: 'image/png', body: PNG_1X1 },
    '/html/assets/img/lazy.png': { type: 'image/png', body: PNG_1X1 },
    '/html/assets/fonts/icons.woff2': { type: 'font/woff2', body: Buffer.from('wOF2fake-font-bytes') },
  };
}
