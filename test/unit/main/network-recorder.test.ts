import { describe, it, expect } from 'vitest';
import { NetworkRecorder, utf8ContentType } from '../../../src/main/network-recorder';

type Body = { body: string; base64Encoded: boolean };

function recorder(bodies: Record<string, Body | Error>, opts: { maxBodyBytes?: number; collectBodies?: boolean } = {}) {
  let t = 1000;
  const asked: string[] = [];
  const rec = new NetworkRecorder({
    maxBodyBytes: opts.maxBodyBytes ?? 1024,
    collectBodies: opts.collectBodies ?? true,
    now: () => t,
    getBody: async (id) => {
      asked.push(id);
      const b = bodies[id];
      if (!b || b instanceof Error) throw b ?? new Error('no body');
      return b;
    },
  });
  return { rec, asked, tick: (ms: number) => (t += ms) };
}

function load(rec: NetworkRecorder, id: string, url: string, type: string, status: number, contentType: string) {
  rec.handle('Network.requestWillBeSent', { requestId: id, request: { url }, type });
  rec.handle('Network.responseReceived', {
    requestId: id,
    type,
    response: { url, status, mimeType: contentType.split(';')[0], headers: { 'Content-Type': contentType } },
  });
  rec.handle('Network.loadingFinished', { requestId: id, encodedDataLength: 10 });
}

describe('NetworkRecorder', () => {
  it('records the document and subresources with UTF-8 text bodies', async () => {
    const png = Buffer.from([137, 80, 78, 71]).toString('base64');
    const { rec } = recorder({
      '1': { body: '<p>café</p>', base64Encoded: false },
      '2': { body: '.a{}', base64Encoded: false },
      '3': { body: png, base64Encoded: true },
    });
    load(rec, '1', 'https://x.com/', 'Document', 200, 'text/html; charset=windows-1250');
    load(rec, '2', 'https://x.com/a.css', 'Stylesheet', 200, 'text/css; charset=iso-8859-2');
    load(rec, '3', 'https://x.com/i.png', 'Image', 200, 'image/png');
    await rec.settle();
    expect(rec.document).toEqual({
      url: 'https://x.com/',
      status: 200,
      contentType: 'text/html; charset=windows-1250',
      html: '<p>café</p>',
    });
    expect(rec.resources.map((r) => [r.url, r.contentType, r.body?.toString('latin1')])).toEqual([
      ['https://x.com/a.css', 'text/css; charset=utf-8', '.a{}'],
      ['https://x.com/i.png', 'image/png', Buffer.from(png, 'base64').toString('latin1')],
    ]);
  });

  it('keeps the original request URL across redirects', async () => {
    const { rec } = recorder({ '5': { body: 'x', base64Encoded: false } });
    rec.handle('Network.requestWillBeSent', { requestId: '5', request: { url: 'https://x.com/old.js' }, type: 'Script' });
    rec.handle('Network.requestWillBeSent', { requestId: '5', request: { url: 'https://x.com/new.js' }, type: 'Script' });
    rec.handle('Network.responseReceived', {
      requestId: '5',
      type: 'Script',
      response: { url: 'https://x.com/new.js', status: 200, mimeType: 'text/javascript', headers: {} },
    });
    rec.handle('Network.loadingFinished', { requestId: '5' });
    await rec.settle();
    expect(rec.resources[0]).toMatchObject({ url: 'https://x.com/new.js', requestUrl: 'https://x.com/old.js' });
  });

  it('records failures, ignores cancelled requests and counts JSON data requests', async () => {
    const { rec } = recorder({ '8': { body: '[1]', base64Encoded: false } });
    rec.handle('Network.requestWillBeSent', { requestId: '6', request: { url: 'https://x.com/gone.js' }, type: 'Script' });
    rec.handle('Network.loadingFailed', { requestId: '6', canceled: false });
    rec.handle('Network.requestWillBeSent', { requestId: '7', request: { url: 'https://x.com/x.js' }, type: 'Script' });
    rec.handle('Network.loadingFailed', { requestId: '7', canceled: true });
    load(rec, '8', 'https://x.com/api.json', 'Fetch', 200, 'application/json');
    load(rec, '9', 'https://x.com/404.png', 'Image', 404, 'text/html');
    await rec.settle();
    expect(rec.failed.map((f) => [f.url, f.status, f.method, f.type])).toEqual([
      ['https://x.com/gone.js', 0, 'GET', 'Script'],
      ['https://x.com/404.png', 404, 'GET', 'Image'],
    ]);
    expect(rec.dataRequests).toBe(1);
    expect(rec.resources.find((r) => r.url.endsWith('404.png'))?.body).toBeUndefined();
  });

  it('leaves out bodies that are too large or unavailable', async () => {
    const { rec } = recorder({ '1': { body: 'x'.repeat(2000), base64Encoded: false }, '2': new Error('evicted') }, { maxBodyBytes: 1000 });
    load(rec, '1', 'https://x.com/big.js', 'Script', 200, 'text/javascript');
    load(rec, '2', 'https://x.com/e.js', 'Script', 200, 'text/javascript');
    await rec.settle();
    expect(rec.resources.map((r) => r.body)).toEqual([undefined, undefined]);
  });

  it('fetches only the document body when collectBodies is false', async () => {
    const { rec, asked } = recorder(
      { '1': { body: '<p>x</p>', base64Encoded: false }, '2': { body: '.a{}', base64Encoded: false } },
      { collectBodies: false },
    );
    load(rec, '1', 'https://x.com/', 'Document', 200, 'text/html');
    load(rec, '2', 'https://x.com/a.css', 'Stylesheet', 200, 'text/css');
    await rec.settle();
    expect(asked).toEqual(['1']);
  });

  it('tracks network idle time', () => {
    const { rec, tick } = recorder({});
    rec.handle('Network.requestWillBeSent', { requestId: '1', request: { url: 'https://x.com/a.js' }, type: 'Script' });
    tick(500);
    expect(rec.idleFor()).toBe(0);
    rec.handle('Network.loadingFailed', { requestId: '1', canceled: true });
    tick(300);
    expect(rec.idleFor()).toBe(300);
  });

  it('builds UTF-8 content types', () => {
    expect(utf8ContentType('text/css; charset=iso-8859-2')).toBe('text/css; charset=utf-8');
    expect(utf8ContentType('application/javascript')).toBe('application/javascript; charset=utf-8');
  });

  it('keeps the first requested document as the page even if an iframe finishes first', async () => {
    const { rec } = recorder({ '1': { body: '<p>main</p>', base64Encoded: false }, '2': { body: '<p>frame</p>', base64Encoded: false } });
    rec.handle('Network.requestWillBeSent', { requestId: '1', request: { url: 'https://x.com/' }, type: 'Document' });
    rec.handle('Network.requestWillBeSent', { requestId: '2', request: { url: 'https://x.com/frame' }, type: 'Document' });
    for (const [id, url] of [['2', 'https://x.com/frame'], ['1', 'https://x.com/']] as const) {
      rec.handle('Network.responseReceived', { requestId: id, type: 'Document', response: { url, status: 200, mimeType: 'text/html', headers: {} } });
      rec.handle('Network.loadingFinished', { requestId: id });
      await rec.settle();
    }
    expect(rec.document).toMatchObject({ url: 'https://x.com/', html: '<p>main</p>' });
  });

  it('keeps the document response when the navigation turns into a download', async () => {
    const { rec } = recorder({});
    rec.handle('Network.requestWillBeSent', { requestId: '1', request: { url: 'https://x.com/file' }, type: 'Document' });
    rec.handle('Network.responseReceived', {
      requestId: '1',
      type: 'Document',
      response: { url: 'https://x.com/file', status: 200, mimeType: 'application/zip', headers: { 'content-type': 'application/zip' } },
    });
    expect(rec.documentResponse).toEqual({ url: 'https://x.com/file', status: 200, contentType: 'application/zip' });
    rec.handle('Network.loadingFailed', { requestId: '1', canceled: false });
    expect(rec.document).toEqual({ url: 'https://x.com/file', status: 200, contentType: 'application/zip', html: '' });
    expect(rec.failed).toEqual([]);
  });

  it('records POST failures with their method and redirects as 3xx entries', async () => {
    const { rec } = recorder({});
    rec.handle('Network.requestWillBeSent', { requestId: '5', request: { url: 'https://x.com/a.png' }, type: 'Image' });
    rec.handle('Network.requestWillBeSent', {
      requestId: '5',
      request: { url: 'https://x.com/' },
      type: 'Image',
      redirectResponse: { url: 'https://x.com/a.png', status: 302 },
    });
    rec.handle('Network.requestWillBeSent', { requestId: '4', request: { url: 'https://x.com/api/save', method: 'POST' }, type: 'Fetch' });
    rec.handle('Network.responseReceived', { requestId: '4', type: 'Fetch', response: { url: 'https://x.com/api/save', status: 405, mimeType: 'text/plain', headers: {} } });
    rec.handle('Network.loadingFinished', { requestId: '4' });
    await rec.settle();
    expect(rec.failed).toEqual([
      { url: 'https://x.com/a.png', status: 302, method: 'GET', type: 'Image' },
      { url: 'https://x.com/api/save', status: 405, method: 'POST', type: 'Fetch' },
    ]);
  });

  it('does not let long-lived connections block network idle', () => {
    const { rec, tick } = recorder({});
    rec.handle('Network.requestWillBeSent', { requestId: '1', request: { url: 'https://x.com/events' }, type: 'EventSource' });
    tick(400);
    expect(rec.idleFor()).toBe(400);
  });
});
