// Server-side database access (Supabase, service role). Used only by app/api routes.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come from .env, or from .env.local which
// `scripts/db.py local-env` writes to point development at the local database.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isProduction, supabaseTarget } from './env';
import { HttpError } from './http';

let client: SupabaseClient | null = null;
let clientFor = '';

export function db(): SupabaseClient {
  // The target is read on every call, so a client built for one address is never used after the environment changed.
  const target = supabaseTarget();
  if (!target) throw new HttpError(503, 'The database is not connected yet.');
  if (client && clientFor === `${target.url}|${target.key}`) return client;
  client = createClient(target.url, target.key, { auth: { persistSession: false, autoRefreshToken: false } });
  clientFor = `${target.url}|${target.key}`;
  return client;
}

// True when a database is configured (and, outside production, false means "UI work with no .env": the in-memory
// stores take over). In production there is no such fallback: with the database missing this THROWS 503, so every
// route that would have quietly kept orders, support or erasure requests in memory refuses instead (SRV-8).
let toldNoDb = false;
export function dbConfigured(): boolean {
  const ok = !!supabaseTarget();
  if (!ok && isProduction()) {
    if (!toldNoDb) { toldNoDb = true; console.error('[env] NODE_ENV=production but no usable database is configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, and ALLOW_REMOTE=1 for a hosted project). Every route that needs data answers 503.'); }
    throw new HttpError(503, 'The database is not connected yet.', undefined, 'database_unavailable');
  }
  return ok;
}

// Database functions raise errors like "OL_STALE: this order was already changed on another phone".
const STATUS: Record<string, number> = {
  OL_BAD_REQUEST: 400, OL_BAD_QTY: 400, OL_EMPTY: 400, OL_NOT_FOUND: 404, OL_NOT_ONE_LOCAL: 404,
  OL_NOT_ACCEPTING: 409, OL_ITEM_UNAVAILABLE: 409, OL_STALE: 409, OL_WRONG_STATE: 409, OL_EXPIRED: 409,
  OL_NOT_DELIVERABLE: 409, OL_PICKED_UP: 409, OL_TAKEN: 409, OL_GONE: 410,
  OL_BAD_STEP: 409, OL_TOO_FAR: 422, OL_PICKUP_MISMATCH: 422, OL_CASH_MISMATCH: 422, OL_IDEMPOTENCY: 422, OL_IDEMPOTENCY_MISMATCH: 422, OL_IN_PROGRESS: 409,
};
// Machine-readable reasons for the dispatch and rider APIs (docs/RIDER_APP_E2E_V1.md section 5).
const CODE: Record<string, string> = {
  OL_NOT_DELIVERABLE: 'order_not_deliverable', OL_PICKED_UP: 'already_picked_up', OL_EXPIRED: 'offer_expired', OL_TAKEN: 'already_taken',
  OL_STALE: 'version_conflict', OL_GONE: 'offer_withdrawn', OL_NOT_FOUND: 'not_found', OL_WRONG_STATE: 'wrong_state',
  OL_BAD_STEP: 'invalid_transition', OL_TOO_FAR: 'too_far', OL_PICKUP_MISMATCH: 'pickup_mismatch', OL_CASH_MISMATCH: 'cash_mismatch', OL_IDEMPOTENCY: 'idempotency_mismatch', OL_IDEMPOTENCY_MISMATCH: 'idempotency_mismatch', OL_IN_PROGRESS: 'in_progress',
};

export function fromDbError(error: { message?: string; code?: string } | null): never {
  const message = error?.message ?? 'Database error';
  const match = message.match(/^(OL_[A-Z_]+):\s*(.*)$/);
  if (match) throw new HttpError(STATUS[match[1]] ?? 400, match[2], undefined, CODE[match[1]]);
  // Only the code and the message: `details` and `hint` can quote the row that was refused (names, phones, addresses).
  console.error('[db]', { code: error?.code, message: message.slice(0, 200) });
  throw new HttpError(500, 'Something went wrong. Please try again.');
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) fromDbError(error);
  return data as T;
}
