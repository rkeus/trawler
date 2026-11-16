import { startServer, type TestServer } from './http-server';

export interface Route {
  status?: number;
  type?: string;
  body?: string | Buffer;
  /** redirect target; default status 301 */
  location?: string;
  headers?: Record<string, string>;
  delayMs?: number;
}

/** Keys are pathnames ("/a.css") or pathname+query ("/a.css?v=1") for exact query matches. */
export type Routes = Record<string, Route>;

export interface FixtureServer extends TestServer {
  /** every requested pathname+query, in order */
  requests: string[];
}

export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Serves a route table; `build` receives the server origin so routes can contain absolute URLs. */
export async function startFixtureServer(build: (origin: string) => Routes): Promise<FixtureServer> {
  let routes: Routes = {};
  const requests: string[] = [];
  const server = await startServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://localhost');
    requests.push(u.pathname + u.search);
    const route = routes[u.pathname + u.search] ?? routes[u.pathname];
    const send = (): void => {
      if (!route) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      const headers: Record<string, string> = { ...route.headers };
      if (route.type) headers['content-type'] = route.type;
      if (route.location) headers.location = route.location;
      res.writeHead(route.status ?? (route.location ? 301 : 200), headers);
      res.end(req.method === 'HEAD' ? undefined : (route.body ?? ''));
    };
    if (route?.delayMs) setTimeout(send, route.delayMs);
    else send();
  });
  routes = build(server.url);
  return { ...server, requests };
}
