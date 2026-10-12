// Idempotency for mutating routes, built on the database's idempotency_begin / idempotency_complete (migration 0221).
// Same key + same request  -> the stored response is replayed (the work is not done twice).
// Same key + other request -> 422 idempotency_mismatch (OL_IDEMPOTENCY_MISMATCH).
// Same key while the first call is still running -> 409 (OL_IN_PROGRESS).
// Keys are scoped by who is calling (customer, staff member, service credential), so one caller can never replay another's response.
// A request without an Idempotency-Key is simply run: the key is optional here (routes that already require one say so themselves).
import { db, fromDbError } from './db';
import { HttpError, json, sha256 } from './http';

type Row = Record<string, any>;
export const KEY_SHAPE = /^[\w:.-]{8,200}$/;
export type Outcome = { status?: number; body: unknown };

export function idempotencyKey(request: Request): string | null {
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) return null;
  if (!KEY_SHAPE.test(key)) throw new HttpError(400, 'Idempotency-Key is not valid.', undefined, 'invalid_request');
  return key;
}

// The core: scope + key + what-was-asked. `run` does the work once; its outcome is stored and replayed.
export async function runIdempotent(scope: string, key: string | null, requestText: string, run: () => Promise<Outcome>): Promise<Outcome & { replayed: boolean }> {
  if (!key) return { ...(await run()), replayed: false };
  const hash = await sha256(requestText);
  const { data, error } = await db().rpc('idempotency_begin', { p_scope: scope, p_key: key, p_request_hash: hash });
  if (error) fromDbError(error); // OL_IDEMPOTENCY_MISMATCH -> 422, OL_IN_PROGRESS -> 409 (db.ts)
  if (data?.state === 'replay') {
    const stored = (data.response ?? {}) as Row;
    const body = stored.body && typeof stored.body === 'object' && !Array.isArray(stored.body) ? { ...stored.body, replayed: true } : stored.body;
    return { status: stored.status ?? 200, body, replayed: true };
  }
  try {
    const out = await run();
    const { error: e } = await db().rpc('idempotency_complete', { p_scope: scope, p_key: key, p_response: { status: out.status ?? 200, body: out.body }, p_status: 'completed' });
    if (e) console.error('[idempotency] could not store the response', { code: e.code, message: (e.message ?? '').slice(0, 120) });
    return { ...out, replayed: false };
  } catch (error) {
    // Mark failed so the caller can retry with the same key (the database reopens a failed key).
    const { error: e } = await db().rpc('idempotency_complete', { p_scope: scope, p_key: key, p_response: null, p_status: 'failed' });
    if (e) console.error('[idempotency] could not mark the key failed', { code: e.code });
    throw error;
  }
}

// Route helper: reads Idempotency-Key, hashes method + path + raw body (read from a clone, so the handler can still read the
// body), scopes by `identity` (e.g. `customer:<hash>`, `partner:<org>:<user>`). identity null = nobody to scope by: just run.
export async function idempotent(request: Request, identity: string | null, run: () => Promise<unknown | Outcome>): Promise<Response> {
  const key = idempotencyKey(request);
  const wrap = async (): Promise<Outcome> => { const r = await run(); return r && typeof r === 'object' && '__outcome' in (r as Row) ? (r as Row).__outcome : { body: r }; };
  if (!key || !identity) { const o = await wrap(); return json(o.body, { status: o.status ?? 200 }); }
  const url = new URL(request.url);
  const text = `${request.method}\n${url.pathname}${url.search}\n${await request.clone().text()}`;
  const out = await runIdempotent(`http:${identity}`, key, text, wrap);
  return json(out.body, { status: out.status ?? 200 });
}
export const withStatus = (status: number, body: unknown) => ({ __outcome: { status, body } });
