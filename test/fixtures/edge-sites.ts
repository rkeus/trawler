import type { Routes } from '../helpers/fixture-server';

const HTML = 'text/html; charset=utf-8';

/** Small sites for the Electron review findings: cross-host redirect, slow page with an early iframe, dialogs, download link, beacons. */
export function edgeSites(origin: string): Routes {
  return {
    // requested through "localhost", redirected to the 127.0.0.1 origin: the scope must follow the redirect
    '/e/start': { location: `${origin}/e/index.html` },
    '/e/index.html': { type: HTML, body: `<!doctype html><html><body><a href="${origin}/e/about.html">About</a> <a href="contact.html">Contact</a></body></html>` },
    '/e/about.html': { type: HTML, body: '<!doctype html><html><body><p>About</p></body></html>' },
    '/e/contact.html': { type: HTML, body: '<!doctype html><html><body><p>Contact</p></body></html>' },
    // the iframe is requested and finished before the main document ends
    '/f/': {
      type: HTML,
      stream: [
        { delayMs: 0, body: '<!doctype html><html><head><title>Main</title></head><body><iframe src="/f/frame.html"></iframe>' },
        { delayMs: 800, body: '<h1>Main page text</h1></body></html>' },
      ],
    },
    '/f/frame.html': { type: HTML, body: '<!doctype html><title>FRAME</title><p>frame</p>' },
    '/a/': { type: HTML, body: '<!doctype html><html><body><script>alert("hello"); confirm("sure?");</script><h1>Alert page</h1></body></html>' },
    '/z/': { type: HTML, body: '<!doctype html><html><body><a href="/z/download">Get the file</a></body></html>' },
    '/z/download': { type: 'application/zip', body: Buffer.from('PK fake zip archive') },
    '/b/': {
      type: HTML,
      body:
        "<!doctype html><html><body><h1>Beacons</h1><script>navigator.sendBeacon('/b/collect', 'x');" +
        "fetch('/b/api/save', { method: 'POST', body: '{}' });</script></body></html>",
    },
  };
}
