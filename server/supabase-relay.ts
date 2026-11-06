/// <reference types="node" />
// Phones reach Supabase only through this server. Jio, Airtel and ACT have blocked *.supabase.co on and off since
// February 2026 (a phone on those networks cannot even look the address up), which left every picture, reel and
// sign-in dead there. This server can reach it, so it asks for the phone and passes the answer back.
import { clientIp, fail, readText } from './http';

const SUPABASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
// What a phone may reach this way: sign-in, and public files in Storage. The database API stays closed: the app reads
// data through /api only.
const ALLOWED = /^(auth\/v1\/[\w./-]+|storage\/v1\/(object|render\/image)\/public\/[\w./%-]+)$/;
const ASK = ['apikey', 'authorization', 'content-type', 'accept', 'x-client-info', 'x-supabase-api-version', 'range', 'if-none-match', 'if-modified-since'];
// No content-length or content-encoding: fetch has already unpacked the body, so the platform sets its own.
const ANSWER = ['content-type', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'location'];
// Files stay a week at Vercel's edge, near the customer, so a picture is one short trip; sign-in answers are never kept.
const FILE_CACHE = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400';

// A public Storage file by its full address (the published media list holds these).
export function relayFile(request: Request, url: string): Promise<Response> {
  return pass(request, url, true);
}

// /api/sb/<path>: the Supabase address the app signs in through.
export function relaySupabase(request: Request): Promise<Response> | Response {
  const { pathname, search } = new URL(request.url);
  const path = pathname.replace(/^\/api\/sb\//, '');
  if (!SUPABASE || !ALLOWED.test(path)) return fail(404, 'Not found.');
  return pass(request, `${SUPABASE}/${path}${search}`, path.startsWith('storage/'));
}

async function pass(request: Request, url: string, file: boolean): Promise<Response> {
  const headers = new Headers({ 'x-forwarded-for': clientIp(request) });
  for (const name of ASK) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readText(request);
  let upstream: Response;
  // manual: Google sign-in answers with a redirect the phone's browser must follow itself.
  try { upstream = await fetch(url, { method: request.method, headers, body, redirect: 'manual' }); }
  catch { return fail(502, 'Could not reach the server. Please try again.'); }
  const answer = new Headers({ 'Cache-Control': file && upstream.ok ? FILE_CACHE : 'no-store' });
  for (const name of ANSWER) { const value = upstream.headers.get(name); if (value) answer.set(name, value); }
  return new Response(upstream.body, { status: upstream.status, headers: answer });
}
