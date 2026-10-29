// The rider gateway: matches a path against the generated route table and calls the same handler Expo would.
// Kept free of Vercel specifics so it can be tested directly.
import { ROUTES, type RouteModule } from './routes.generated';

type Handler = (request: Request, params: Record<string, string>) => Response | Promise<Response>;
type Matched = { pattern: string; mod: RouteModule; params: Record<string, string> };

const compiled = ROUTES.map((r) => {
  const segs = r.pattern.split('/').filter(Boolean);
  // Static segments rank above [param] ones: /rider/jobs/current must beat /rider/jobs/[id].
  const score = segs.map((s) => (s.startsWith('[') ? '1' : '0')).join('');
  return { ...r, segs, score };
}).sort((a, b) => a.score.localeCompare(b.score));

export function match(pathname: string): Matched | null {
  const parts = pathname.split('/').filter(Boolean);
  for (const r of compiled) {
    if (r.segs.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const s = r.segs[i];
      if (s.startsWith('[')) {
        try { params[s.slice(1, -1)] = decodeURIComponent(parts[i]); } catch { ok = false; break; }
      } else if (s !== parts[i]) { ok = false; break; }
    }
    if (ok) return { pattern: r.pattern, mod: r.mod, params };
  }
  return null;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ evt: 'rider_api', ...fields }));
}

export async function handle(request: Request, pathname: string, dbReady?: () => Promise<boolean>): Promise<Response> {
  const started = Date.now();
  const rid = (request.headers.get('x-request-id') ?? '').slice(0, 64).replace(/[^\w.-]/g, '') || crypto.randomUUID();
  const method = request.method.toUpperCase();
  let route = 'unmatched';
  let res: Response;
  try {
    if (pathname === '/api/rider/_health') {
      route = '/api/rider/_health';
      res = json(200, { ok: true });
    } else if (pathname === '/api/rider/_ready') {
      route = '/api/rider/_ready';
      const ok = dbReady ? await dbReady().catch(() => false) : false;
      res = json(ok ? 200 : 503, { ok });
    } else {
      const m = match(pathname);
      if (!m) {
        res = json(404, { error: 'Not found.' });
      } else {
        route = m.pattern;
        const handler = m.mod[method === 'HEAD' ? 'GET' : method] as Handler | undefined;
        if (!handler) {
          const allow = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((x) => typeof m.mod[x] === 'function').join(', ');
          res = json(405, { error: 'Method not allowed.' }, { allow });
        } else {
          res = await handler(request, m.params);
        }
      }
    }
  } catch {
    res = json(500, { error: 'Something went wrong. Please try again.' });
  }
  const ms = Date.now() - started;
  const status = res.status;
  const level = status >= 500 || ms > 3000 ? 'error' : status === 401 || status === 403 || status === 429 ? 'warn' : 'info';
  log({ rid, method, route, status, ms, level });
  const headers = new Headers(res.headers);
  headers.set('x-request-id', rid);
  return new Response(method === 'HEAD' ? null : res.body, { status, headers });
}
