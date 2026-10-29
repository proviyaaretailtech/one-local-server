// The one way this server calls the Master server (the control plane). Nothing is routed through it yet: this file
// only knows how to make the call safely, and health asks it whether Master answers to our keys.
//
//   - Address: MASTER_SERVER_URL. Plain http is refused in production unless the host is this machine.
//   - Identity: one key per caller. Customer and rider routes call as `customer` (INTERNAL_KEY_CUSTOMER); the VINII
//     Partner routes (/api/partner/*) call as `partner` (INTERNAL_KEY_PARTNER). The key goes in `x-internal-key` and
//     never appears in a log line, an error message or a return value.
//   - Every call has a timeout. Only a call that carries an Idempotency-Key is retried, and only when Master could not
//     be reached or answered 5xx: Master recognises the repeated key, so a retry cannot make anything happen twice.
//   - Redirects are never followed: fetch would carry x-internal-key to wherever a 3xx points (another host, or plain
//     http). A 3xx is reported as Master's answer and the call stops there.
import { isLocalUrl } from './env';

export type MasterCaller = 'customer' | 'partner';
export type MasterStatus = 'ok' | 'wrong_key' | 'unreachable' | 'not_configured';

const KEY_ENV: Record<MasterCaller, string> = { customer: 'INTERNAL_KEY_CUSTOMER', partner: 'INTERNAL_KEY_PARTNER' };

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

// Why a call did not produce an answer from Master. `status` is Master's HTTP status when it did answer (code 'http').
export class MasterError extends Error {
  constructor(public code: 'not_configured' | 'insecure_url' | 'unreachable' | 'timeout' | 'http', message: string, public status?: number) {
    super(message);
    this.name = 'MasterError';
  }
}

// The caller a request speaks for, from its path: the partner app's routes are the partner, everything else the customer.
export function masterCallerFor(pathname: string): MasterCaller {
  return /^\/api\/partner(\/|$)/.test(pathname) ? 'partner' : 'customer';
}

// Master's base address (no trailing slash) and the caller's key, or why they cannot be used. Nothing here echoes the key.
function target(caller: MasterCaller, env: Env): { base: string; key: string } {
  const raw = env.MASTER_SERVER_URL?.trim();
  const key = env[KEY_ENV[caller]]?.trim();
  if (!raw || !key) throw new MasterError('not_configured', `Master is not configured (needs MASTER_SERVER_URL and ${KEY_ENV[caller]})`);
  let url: URL;
  try { url = new URL(raw); } catch { throw new MasterError('not_configured', 'MASTER_SERVER_URL is not a valid address'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new MasterError('insecure_url', 'MASTER_SERVER_URL must be http(s)');
  // The key would travel in clear text over plain http; only this machine is exempt.
  if (url.protocol === 'http:' && (env.NODE_ENV ?? process.env.NODE_ENV) === 'production' && !isLocalUrl(raw)) {
    throw new MasterError('insecure_url', `Refusing to send a key over plain http to ${url.hostname}; use https`);
  }
  return { base: raw.replace(/\/+$/, ''), key };
}

export type MasterCall = {
  as: MasterCaller;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  // The action's own key. Present = the call may be retried; absent = it is sent exactly once.
  idempotencyKey?: string;
  // What sent it, for Master's records (x-ol-source). Defaults to `one-local-<caller>`.
  source?: string;
  timeoutMs?: number;
  retries?: number;
  env?: Env;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
};

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// One request to Master. Resolves with Master's parsed JSON on 2xx; otherwise throws a MasterError (never with the key in it).
export async function masterFetch<T = unknown>(path: string, call: MasterCall): Promise<T> {
  const env = call.env ?? process.env;
  const { base, key } = target(call.as, env);
  const doFetch = call.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = call.timeoutMs ?? 5000;
  const attempts = call.idempotencyKey ? 1 + Math.max(0, call.retries ?? 2) : 1;
  const headers: Record<string, string> = { 'x-internal-key': key, 'x-ol-source': call.source ?? `one-local-${call.as}`, accept: 'application/json' };
  if (call.idempotencyKey) headers['Idempotency-Key'] = call.idempotencyKey;
  if (call.body !== undefined) headers['content-type'] = 'application/json';
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;

  let last: MasterError = new MasterError('unreachable', 'Master could not be reached');
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await (call.sleep ?? wait)(200 * 2 ** (attempt - 1));
    let res: Response;
    try {
      res = await doFetch(url, { method: call.method ?? 'GET', headers, body: call.body === undefined ? undefined : JSON.stringify(call.body), signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    } catch (error) {
      // The underlying error is dropped on purpose: some carry the request, and the request carries the key.
      const timedOut = (error as { name?: string })?.name === 'TimeoutError' || (error as { name?: string })?.name === 'AbortError';
      last = timedOut ? new MasterError('timeout', `Master did not answer within ${timeoutMs} ms`) : new MasterError('unreachable', 'Master could not be reached');
      continue;
    }
    // With redirect 'manual' a 3xx comes back as itself (status 0 'opaqueredirect' in a browser); either way, stop here.
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      await res.body?.cancel().catch(() => {});
      throw new MasterError('http', `Master answered with a redirect (${res.status}); not followed`, res.status);
    }
    if (res.ok) {
      const text = await res.text();
      try { return (text ? JSON.parse(text) : null) as T; } catch { throw new MasterError('http', `Master answered ${res.status} with a body that is not JSON`, res.status); }
    }
    await res.body?.cancel().catch(() => {});
    last = new MasterError('http', `Master answered ${res.status}`, res.status);
    if (res.status < 500) break; // Master said no; asking again will not change that.
  }
  throw last;
}

// Is Master reachable with this caller's key? Asks GET /api/internal/whoami and checks Master recognised the right caller.
export async function checkMaster(as: MasterCaller, options: { env?: Env; fetchImpl?: FetchLike; timeoutMs?: number } = {}): Promise<MasterStatus> {
  try {
    const me = await masterFetch<{ caller?: string }>('/api/internal/whoami', { as, env: options.env, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs ?? 1500 });
    // Another server's key in our variable would be accepted by Master but act as someone else.
    return me?.caller === as ? 'ok' : 'wrong_key';
  } catch (error) {
    if (!(error instanceof MasterError)) return 'unreachable';
    if (error.code === 'not_configured' || error.code === 'insecure_url') return 'not_configured';
    if (error.code === 'http' && (error.status === 401 || error.status === 403)) return 'wrong_key';
    return 'unreachable';
  }
}

// checkMaster, remembered for 30 s per caller so a busy health endpoint does not call Master on every probe.
const cache = new Map<MasterCaller, { at: number; status: Promise<MasterStatus> }>();
export function masterStatus(as: MasterCaller, options: { ttlMs?: number; now?: () => number } & Parameters<typeof checkMaster>[1] = {}): Promise<MasterStatus> {
  const now = (options.now ?? Date.now)();
  const hit = cache.get(as);
  if (hit && now - hit.at < (options.ttlMs ?? 30_000)) return hit.status;
  const status = checkMaster(as, options);
  cache.set(as, { at: now, status });
  return status;
}
export const resetMasterStatusCache = () => cache.clear();
