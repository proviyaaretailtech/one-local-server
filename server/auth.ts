// Who is calling: a signed-in customer (Supabase access token) and/or a device key.
import { supabaseUrl } from './env';
import { customerKey, sha256 } from './http';

const g = globalThis as unknown as { __onecityUsers?: Map<string, { id: string | null; until: number }> };
const cache = (g.__onecityUsers ??= new Map());

// Asks Supabase Auth who the token belongs to. Results are cached briefly; an invalid or
// expired token simply counts as "not signed in".
export async function signedInUserId(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (token.length < 20 || token.length > 4096) return null;
  const key = await sha256(token);
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.id;
  const url = supabaseUrl(); // null for a remote project unless ALLOW_REMOTE=1 (server/env.ts)
  const apikey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  let id: string | null = null;
  if (url && apikey) {
    try {
      const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      if (r.ok) id = (await r.json())?.id ?? null;
    } catch {}
  }
  if (cache.size > 5000) cache.clear();
  cache.set(key, { id, until: Date.now() + (id ? 60_000 : 10_000) });
  return id;
}

export type Caller = { userId: string | null; owner: string | null; matches: string[] };

// `owner` is what new records are stored under (the account when signed in, else the device);
// `matches` is everything this caller may read (account + this device's pre-sign-in orders).
export async function caller(request: Request): Promise<Caller> {
  const [userId, device] = [await signedInUserId(request), customerKey(request)];
  const userHash = userId ? await sha256(`user:${userId}`) : null;
  const deviceHash = device ? await sha256(device) : null;
  return { userId, owner: userHash ?? deviceHash, matches: [userHash, deviceHash].filter((x): x is string => !!x) };
}
