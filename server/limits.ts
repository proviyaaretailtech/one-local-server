// Rate limits for callers who are not signed-in staff: customers, devices and anonymous visitors (SRV-7).
//
// What a limit may be keyed on:
//   * a signed-in user (a Supabase account: the server verified the token itself, so it cannot be rotated for free);
//   * the caller's network address (http.ts clientIp: only the entry a trusted proxy added, never a header the client wrote);
//   * a device key, but only IN ADDITION to the address. The device key is invented by the caller (any 24-128 letters), so a
//     limit on it alone is gone the moment the caller sends a new one. It is kept because it stops one phone from using up
//     the whole address (a mobile carrier puts many customers behind one address) before the address ceiling is reached.
// Every request counts against all that apply. The address ceiling is higher than the per-caller limit, since many real people
// can share an address, but it is finite: an attacker who rotates device keys or throwaway accounts still meets it.
//
// Where the counters live: this process's memory (http.ts limit) always, and, when the database is configured and has the
// shared counter (db-requests-server.md: ol_rate_limit_hit), in the database too, so every server process counts the same
// requests. A database that cannot be reached, or has no such function yet, never turns the limit off: the in-process
// counters keep working and the problem is logged once.
import { signedInUserId } from './auth';
import { db } from './db';
import { supabaseTarget } from './env';
import { clientIp, customerKey, HttpError, limit, sha256 } from './http';

export type LimitOptions = {
  // The most one address may make in the window when the caller is signed in (default 10 x max).
  ipMax?: number;
  // The most one address may make when the caller is NOT signed in: the strict one (default 3 x max).
  anonIpMax?: number;
  // false = do not ask Supabase who the user is (cheap public endpoints): the address and the device key still apply.
  verify?: boolean;
};

type Store = (key: string, max: number, windowSeconds: number) => Promise<{ allowed: boolean; retryAfter?: number } | null>;

let missingUntil = 0, told = 0;
const databaseStore: Store = async (key, max, windowSeconds) => {
  if (!supabaseTarget() || Date.now() < missingUntil) return null;
  const { data, error } = await db().rpc('ol_rate_limit_hit', { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (error) {
    // PGRST202 / 42883: the function is not in this database yet. Stop asking for five minutes.
    if (['PGRST202', '42883'].includes(error.code ?? '')) missingUntil = Date.now() + 300_000;
    if (Date.now() - told > 60_000) { told = Date.now(); console.warn('[limits] shared counter unavailable, using this process only:', error.code ?? error.message?.slice(0, 80)); }
    return null;
  }
  const r = data as { allowed?: boolean; retry_after?: number } | null;
  return r && typeof r.allowed === 'boolean' ? { allowed: r.allowed, retryAfter: r.retry_after } : null;
};

let store: Store = databaseStore;
// For checks only: swap the shared counter for a fake one, or pass null to put the database one back.
export const setSharedLimitStore = (s: Store | null) => { store = s ?? databaseStore; };

async function shared(subject: string, name: string, max: number, windowMs: number) {
  // Only a hash of the subject leaves this process: addresses and user ids are personal data and stay out of the counter table.
  const key = `${name}:${(await sha256(`limit:${subject}`)).slice(0, 40)}`;
  const answer = await store(key, max, Math.max(1, Math.ceil(windowMs / 1000))).catch(() => null);
  if (answer && !answer.allowed) {
    const seconds = Math.max(1, Math.ceil(answer.retryAfter ?? windowMs / 1000));
    throw new HttpError(429, `Too many attempts. Please try again in ${seconds} seconds.`, { 'Retry-After': String(seconds) });
  }
}

export async function limitCaller(request: Request, name: string, max: number, windowMs: number, opts: LimitOptions = {}) {
  const ip = clientIp(request);
  const user = opts.verify === false ? null : await signedInUserId(request);
  const device = customerKey(request);
  const counts: { subject: string; max: number }[] = [];
  if (user) counts.push({ subject: `user:${user}`, max });
  else if (device) counts.push({ subject: `device:${device}`, max });
  // 'direct' = no address is known (no trusted proxy header). All such callers would share one bucket, so it is only a coarse flood
  // guard (20 x), never the strict per-address limit: a host that does not send the header must not throttle every customer at once.
  const ipMax = user ? opts.ipMax ?? max * 10 : opts.anonIpMax ?? max * 3;
  counts.push({ subject: `ip:${ip}`, max: ip === 'direct' ? ipMax * 20 : ipMax });
  for (const c of counts) limit(c.subject, name, c.max, windowMs); // this process, first and cheapest
  for (const c of counts) await shared(c.subject, name, c.max, windowMs); // then every process
  return { ip, userId: user, device };
}
