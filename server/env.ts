// The server's environment guard. Two rules, applied in one place so no route has to remember them:
//
//   1. This server only talks to a LOCAL Supabase unless ALLOW_REMOTE=1 is set on purpose (SEC-1). A `.env` that
//      carries a hosted project's URL and service-role key therefore cannot reach that project by accident:
//      without the flag the server behaves as if no database were configured (and in production that means
//      every route answers 503, see db.ts). The host that really serves production sets ALLOW_REMOTE=1.
//   2. A Supabase management token (a personal access token that can read every project's keys and run SQL) has
//      no use inside this server. It is removed from the process environment the moment this module loads, so
//      nothing here can read it, log it or send it anywhere. Use `supabase login` for the CLI instead.
//
// Nothing in this file prints a key, a token or a URL path: a refusal names the host only.
Reflect.deleteProperty(process.env, 'SUPABASE_ACCESS_TOKEN');

export const isProduction = () => process.env.NODE_ENV === 'production';

// Loopback only: the Supabase CLI's local stack. A name that merely contains "local" is not enough.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)$/i;
export function isLocalUrl(url: string | undefined | null): boolean {
  try { return LOCAL_HOST.test(new URL(String(url)).hostname); } catch { return false; }
}

export const remoteAllowed = () => process.env.ALLOW_REMOTE === '1';

let told = false;
function refuse(url: string) {
  if (told) return;
  told = true;
  let host = 'a remote host';
  try { host = new URL(url).hostname; } catch { /* keep the generic wording */ }
  console.error(`[env] Refusing to use the Supabase project at ${host}: it is not a local database. Set ALLOW_REMOTE=1 on the server that is meant to use it. Until then this server runs without a database.`);
}

// The Supabase address this server may use, or null (not configured, or remote without ALLOW_REMOTE=1).
export function supabaseUrl(): string | null {
  const url = process.env.SUPABASE_URL?.trim();
  if (!url) return null;
  if (!isLocalUrl(url) && !remoteAllowed()) { refuse(url); return null; }
  return url;
}

// The URL and service-role key together, or null. Every database call goes through this.
export function supabaseTarget(): { url: string; key: string } | null {
  const url = supabaseUrl(), key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && key ? { url, key } : null;
}
