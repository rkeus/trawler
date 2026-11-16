import type { CapturedResponse, CaptureResult } from '../engine';

type Failure = CaptureResult['failed'][number];

export interface RecorderOptions {
  /** reads a finished response body (CDP Network.getResponseBody) */
  getBody: (requestId: string) => Promise<{ body: string; base64Encoded: boolean }>;
  /** decoded bodies above this are left out (undefined) */
  maxBodyBytes: number;
  /** false: read only the document body (verification needs no resource bodies) */
  collectBodies?: boolean;
  /** injectable clock for tests */
  now?: () => number;
}

export interface RecordedDocument {
  url: string;
  status: number;
  contentType?: string;
  /** decoded document text ('' when unavailable or binary) */
  html: string;
}

export interface DocumentResponse {
  url: string;
  status: number;
  contentType?: string;
}

interface Tracked {
  url: string;
  /** URL of the first request, kept across redirects (same requestId) */
  requestUrl: string;
  type: string;
  method: string;
  status?: number;
  mimeType?: string;
  contentType?: string;
}

const TEXT_TYPE = /^(text\/|application\/(javascript|x-javascript|ecmascript|json|ld\+json|manifest\+json|xml|xhtml\+xml)|image\/svg\+xml)/i;
/** long-lived connections never finish; tracking them would keep the network "busy" until the render timeout */
const UNTRACKED_TYPES = new Set(['EventSource', 'WebSocket']);

function headerValue(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && typeof value === 'string') return value;
  }
  return undefined;
}

/** CDP delivers text bodies decoded; Trawler stores them as UTF-8 and says so. */
export function utf8ContentType(contentType: string): string {
  return `${contentType.split(';')[0]!.trim()}; charset=utf-8`;
}

/**
 * Collects what a page loads from Chrome DevTools Protocol Network events (feed every debugger message to
 * handle()). The main document is the first Document *requested* after Network.enable (iframes are requested
 * later, even if they finish first); every other finished http(s) response becomes a CapturedResponse.
 * Pure: no Electron import, unit-tested with synthetic events.
 */
export class NetworkRecorder {
  readonly resources: CapturedResponse[] = [];
  readonly failed: Failure[] = [];
  dataRequests = 0;
  document?: RecordedDocument;
  /** status and content type of the main document, known before its body (or before it becomes a download) */
  documentResponse?: DocumentResponse;
  private readonly inflight = new Map<string, Tracked>();
  private readonly bodyTasks: Promise<void>[] = [];
  private readonly now: () => number;
  private lastActivity: number;
  private docRequestId?: string;

  constructor(private readonly opts: RecorderOptions) {
    this.now = opts.now ?? Date.now;
    this.lastActivity = this.now();
  }

  handle(method: string, params: any): void {
    const id: unknown = params?.requestId;
    if (typeof id !== 'string') return;
    switch (method) {
      case 'Network.requestWillBeSent': {
        const prev = this.inflight.get(id);
        const type: string = prev?.type ?? params.type ?? 'Other';
        if (!prev && UNTRACKED_TYPES.has(type)) return;
        const url = String(params.request?.url ?? '');
        const requestMethod = String(params.request?.method ?? prev?.method ?? 'GET');
        if (prev && params.redirectResponse) {
          const r = params.redirectResponse;
          this.failed.push({ url: String(r.url ?? prev.url), status: Number(r.status ?? 0), method: prev.method, type: prev.type });
        }
        if (type === 'Document' && this.docRequestId === undefined) this.docRequestId = id;
        this.inflight.set(id, { url, requestUrl: prev?.requestUrl ?? url, type, method: requestMethod });
        break;
      }
      case 'Network.responseReceived': {
        const t = this.inflight.get(id);
        if (!t) return;
        const r = params.response ?? {};
        if (typeof r.url === 'string') t.url = r.url;
        t.status = r.status;
        t.mimeType = r.mimeType;
        t.contentType = headerValue(r.headers, 'content-type') ?? r.mimeType;
        if (id === this.docRequestId) {
          this.documentResponse = { url: t.url, status: t.status ?? 0, ...(t.contentType ? { contentType: t.contentType } : {}) };
        }
        break;
      }
      case 'Network.loadingFinished': {
        const t = this.inflight.get(id);
        this.inflight.delete(id);
        if (t) this.bodyTasks.push(this.finish(id, t));
        break;
      }
      case 'Network.loadingFailed': {
        const t = this.inflight.get(id);
        this.inflight.delete(id);
        if (!t) break;
        if (id === this.docRequestId && this.documentResponse) {
          // e.g. a download: the response arrived, then the navigation was cancelled
          this.document = { ...this.documentResponse, html: '' };
        } else if (!params.canceled && /^https?:/i.test(t.url)) {
          this.failed.push({ url: t.url, status: t.status ?? 0, method: t.method, type: t.type });
        }
        break;
      }
      default:
        return;
    }
    this.lastActivity = this.now();
  }

  /** milliseconds since the last network activity; 0 while requests are in flight */
  idleFor(): number {
    return this.inflight.size > 0 ? 0 : this.now() - this.lastActivity;
  }

  /** waits for every body read, including ones started meanwhile */
  async settle(): Promise<void> {
    while (this.bodyTasks.length > 0) await Promise.allSettled(this.bodyTasks.splice(0));
  }

  private async finish(id: string, t: Tracked): Promise<void> {
    if (!/^https?:/i.test(t.url)) return;
    const status = t.status ?? 0;
    const isDocument = id === this.docRequestId;
    if (status >= 400) this.failed.push({ url: t.url, status, method: t.method, type: t.type });
    if ((t.type === 'XHR' || t.type === 'Fetch') && /json/i.test(t.mimeType ?? '')) this.dataRequests++;

    let body: Buffer | undefined;
    let decoded = false;
    if (status >= 200 && status < 300 && (isDocument || this.opts.collectBodies !== false)) {
      try {
        const b = await this.opts.getBody(id);
        body = b.base64Encoded ? Buffer.from(b.body, 'base64') : Buffer.from(b.body, 'utf8');
        decoded = !b.base64Encoded;
      } catch {
        body = undefined; // evicted or unavailable: the crawl fetches it itself
      }
    }

    if (isDocument) {
      this.document = {
        url: t.url,
        status,
        ...(t.contentType ? { contentType: t.contentType } : {}),
        html: body && decoded ? body.toString('utf8') : '',
      };
      return;
    }
    if (body && body.length > this.opts.maxBodyBytes) body = undefined;
    const contentType =
      t.contentType && body && decoded && TEXT_TYPE.test(t.contentType) ? utf8ContentType(t.contentType) : t.contentType;
    this.resources.push({
      url: t.url,
      ...(t.requestUrl !== t.url ? { requestUrl: t.requestUrl } : {}),
      status,
      ...(contentType ? { contentType } : {}),
      ...(body ? { body } : {}),
      type: t.type,
    });
  }
}
