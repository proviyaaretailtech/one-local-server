// Helpers shared by the /api routes. Expo Router API routes run only on the server, so
// nothing in /server is ever bundled into the app.

export class HttpError extends Error {
  // `code` is a machine-readable reason ('offer_expired'); apps that only know `detail` ignore it.
  // `extra` carries machine-readable facts the app needs with the error (the server's job on a version conflict, attempts left).
  public extra?: Record<string, unknown>;
  constructor(public status: number, public detail: string, public headers?: Record<string, string>, public code?: string) { super(detail); }
}

export const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init);

// The app reads `detail` from error bodies, so errors keep the shape the old backend used.
export const fail = (status: number, detail: string, headers?: Record<string, string>, code?: string, extra?: Record<string, unknown>) =>
  Response.json(code ? { detail, code, ...extra } : { detail, ...extra }, { status, headers });

// Anything that looks like a credential is masked before it is logged: a Google key in a request address, a bearer token, a JWT, a
// Supabase key. An error that carries the request address (a failed fetch) must not write the key it was called with into the logs.
export function redact(value: unknown): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}` : typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  return text
    .replace(/([?&](?:key|apikey|api_key|token|access_token)=)[^&\s"')]+/gi, '$1[hidden]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[hidden]')
    .replace(/Bearer\s+[\w.~+/=-]{12,}/gi, 'Bearer [hidden]')
    .replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[hidden]')
    .replace(/\b(?:sb_secret|sb_publishable|sbp)_[\w-]{8,}/g, '[hidden]')
    .slice(0, 4000);
}

type Handler = (request: Request, params: Record<string, string>) => Response | Promise<Response>;

export function route(handler: Handler): Handler {
  return async (request, params) => {
    try {
      // Rider API is served by the dedicated rider gateway (specs/rider-server). A customer host that sets
      // RIDER_ONLY_ON_GATEWAY=1 refuses rider paths; the gateway sets RIDER_GATEWAY=1 and serves them.
      if (process.env.RIDER_ONLY_ON_GATEWAY === '1' && process.env.RIDER_GATEWAY !== '1' && /^\/api\/rider(\/|$)/.test(new URL(request.url).pathname)) {
        return fail(404, 'Not found.');
      }
      return await handler(request, params ?? {});
    } catch (error) {
      if (error instanceof HttpError) return fail(error.status, error.detail, error.headers, error.code, error.extra);
      console.error('[api]', request.method, new URL(request.url).pathname, redact(error));
      return fail(500, 'Something went wrong. Please try again.');
    }
  };
}

// The body as text, refused as soon as it is over the limit: the declared Content-Length is checked first and a
// body without one is read in pieces and dropped at the limit, so a huge upload is never held in memory whole.
export async function readText(request: Request, maxBytes = 64 * 1024): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, 'Request is too large');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new HttpError(413, 'Request is too large'); }
    chunks.push(value);
  }
  const whole = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { whole.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(whole);
}

export async function readBody<T = Record<string, unknown>>(request: Request, maxBytes = 64 * 1024): Promise<T> {
  const text = await readText(request, maxBytes);
  try {
    const body = JSON.parse(text || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as T;
  } catch {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
}

// Per-process limiter. It is the first gate everywhere; where the caller is anonymous or money is involved, limits.ts adds
// the shared counter in the database on top (a serverless host runs many processes, each with its own copy of this map).
// Expired buckets are swept out, and the map is capped, so nobody can grow it without bound by sending new subjects.
const g = globalThis as unknown as { __onecityLimits?: Map<string, { count: number; reset: number }> };
const buckets = (g.__onecityLimits ??= new Map());
const MAX_BUCKETS = 50_000;

function prune(now: number) {
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
  // Still too many live ones: forget the oldest (Map keeps insertion order). A forgotten bucket only ever lets one
  // extra request through, which is better than an out-of-memory server.
  for (const k of buckets.keys()) { if (buckets.size <= MAX_BUCKETS * 0.8) break; buckets.delete(k); }
}

export function limit(subject: string, name: string, max: number, windowMs: number) {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) prune(now);
  const key = `${name}:${subject}`;
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  if (++bucket.count > max) {
    const seconds = Math.ceil((bucket.reset - now) / 1000);
    throw new HttpError(429, `Too many attempts. Please try again in ${seconds} seconds.`, { 'Retry-After': String(seconds) });
  }
}

// The caller's network address, for limits that must not depend on anything the caller chooses. Behind a reverse proxy the
// proxy appends the address it saw to X-Forwarded-For, so the entry that counts is the LAST one from the right that a trusted
// hop added; everything to its left is whatever the client claimed. TRUSTED_PROXY_HOPS says how many trusted hops there are
// (default 1 in production, where this server sits behind its host's proxy, and 0 elsewhere, where the header is ignored).
// 'direct' means no address is known; callers treat that as one shared (and so stricter) bucket, never as "unlimited".
export function clientIp(request: Request): string {
  const configured = Number(process.env.TRUSTED_PROXY_HOPS);
  const hops = Number.isInteger(configured) && configured >= 0 && process.env.TRUSTED_PROXY_HOPS?.trim() ? configured : process.env.NODE_ENV === 'production' ? 1 : 0;
  if (hops === 0) return 'direct';
  const forwarded = (request.headers.get('x-forwarded-for') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const hit = forwarded.length ? forwarded[Math.max(0, forwarded.length - hops)] : request.headers.get('x-real-ip')?.trim();
  return hit && /^[0-9a-fA-F:.]{3,45}$/.test(hit) ? hit.toLowerCase() : 'direct';
}

// Equal-length digests are compared without stopping at the first difference, so the time taken says nothing about how many
// leading characters were right. Used for codes and secrets; both sides are hashed first so their lengths do not leak either.
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(`eq:${a}`), sha256(`eq:${b}`)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0 && x.length === y.length;
}

// Each device sends a random key it created itself (src/api.ts). It is a convenience that keeps one phone's orders apart from
// another's, NOT an identity: anyone can invent one, so a limit keyed on it alone proves nothing (use limits.ts, which pairs it
// with the address or the signed-in user). Only its hash is stored.
export function customerKey(request: Request): string | null {
  const key = request.headers.get('x-customer-key');
  return key && /^[A-Za-z0-9_-]{24,128}$/.test(key) ? key : null;
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// HMAC-SHA256 checks. crypto.subtle.verify recomputes the signature and compares in constant time, so a
// forged one cannot be guessed byte by byte from timings. Used for Razorpay's webhook and for the
// dispatch service's signed calls (dispatch.ts).
export async function signatureOk(secret: string, message: string, signature: unknown): Promise<boolean> {
  if (!secret || typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = new Uint8Array(signature.match(/../g)!.map(h => parseInt(h, 16)));
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(message));
}

// The same check for a base64 signature (Cashfree: base64(HMAC-SHA256(secret, timestamp + raw body))). The signature is decoded and
// handed to crypto.subtle.verify, which compares in constant time, so the time taken says nothing about how many bytes matched.
export async function signatureBase64Ok(secret: string, message: string, signature: unknown): Promise<boolean> {
  if (!secret || typeof signature !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(signature.trim())) return false;
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = new Uint8Array(Array.from(atob(signature.trim()), c => c.charCodeAt(0))); } catch { return false; }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(message));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))), b => b.toString(16).padStart(2, '0')).join('');
}
