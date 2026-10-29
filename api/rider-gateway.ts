// Vercel Function for the One Rider API. vercel.json rewrites /api/rider/* and /api/geo/* here as
// /api/rider-gateway?__s=<scope>&__p=<rest of path>; the original path and query are rebuilt before dispatch.
process.env.RIDER_GATEWAY = '1';

import { handle } from '../rider-server/gateway';
import { supabaseTarget } from '../server/env';

async function dbReady(): Promise<boolean> {
  const t = supabaseTarget();
  if (!t) return false;
  const r = await fetch(`${t.url}/rest/v1/`, { headers: { apikey: t.key }, signal: AbortSignal.timeout(2500) });
  return r.ok;
}

function dispatch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const scope = url.searchParams.get('__s') === 'geo' ? 'geo' : 'rider';
  const rest = (url.searchParams.get('__p') ?? '').replace(/^\/+/, '');
  url.searchParams.delete('__s');
  url.searchParams.delete('__p');
  const pathname = `/api/${scope}${rest ? '/' + rest : ''}`;
  url.pathname = pathname;
  const init: RequestInit & { duplex?: string } = { method: request.method, headers: request.headers };
  if (!['GET', 'HEAD'].includes(request.method)) { init.body = request.body; init.duplex = 'half'; }
  return handle(new Request(url, init), pathname, dbReady);
}

export const GET = dispatch;
export const HEAD = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
