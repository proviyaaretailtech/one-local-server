// Partner sign-in with the application code (specs/partner-code-sign-in, database migration 0345).
// A partner who signed up on the website sees a code at the end (the application reference, OLP-XXXXXXXX). On the first start of the
// VINII Partner app they type it instead of an email and password. Public and unauthenticated by design, so the guards are the
// database's throttle (8 wrong tries per address in 15 minutes, 300 per hour overall, recorded in ol_partner_code_attempts), this
// route's own rate limit, and a generic answer for every wrong code (never why).
//
// A right code is exchanged for a one-time sign-in token: the server asks Supabase Auth to make a magic-link token for that one
// login (service role, never sent to a browser) and gives the app only the token hash. The app turns it into a session with
// verifyOTP. The token works once and expires with the project's magic-link lifetime; the code itself stays valid for 30 days.
import { db, rpc } from './db';
import { clientIp, HttpError, sha256 } from './http';
import { limitCaller } from './limits';

type Resolved =
  | { ok: true; user_id: string; email: string; organization_id: string | null; application_status: string; reference: string }
  | { ok: false; reason: 'invalid' | 'locked'; retry_after_seconds?: number };

export async function codeLogin(request: Request, body: Record<string, unknown>) {
  const code = typeof body.code === 'string' ? body.code.slice(0, 40) : '';
  if (!code.trim()) throw new HttpError(400, 'Type the code you got when you signed up.', undefined, 'invalid_request');
  // One caller may not hammer this route, whatever the database lets through.
  await limitCaller(request, 'partner-code-login', 20, 15 * 60_000, { verify: false });
  const ipHash = (await sha256(`partner-code:${clientIp(request)}`)).slice(0, 32);
  const r = await rpc<Resolved>('ol_partner_code_resolve', { p_code: code, p_ip_hash: ipHash });
  if (!r.ok) {
    if (r.reason === 'locked') {
      const seconds = Math.max(60, Math.min(3600, Number(r.retry_after_seconds) || 900));
      throw new HttpError(429, 'Too many wrong codes. Try again in a few minutes, or sign in with your email and password.', { 'Retry-After': String(seconds) }, 'code_locked');
    }
    throw new HttpError(401, 'That code is not right. Check it, or sign in with your email and password.', undefined, 'invalid_code');
  }
  const { data, error } = await db().auth.admin.generateLink({ type: 'magiclink', email: r.email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error('[code-login] could not make a sign-in token:', error?.message ?? 'no token');
    throw new HttpError(502, 'Sign-in is not available right now. Please try again, or use your email and password.', undefined, 'sign_in_unavailable');
  }
  return {
    token_hash: tokenHash,
    type: 'magiclink' as const,
    email: r.email,
    organization_id: r.organization_id,
    application_status: r.application_status,
  };
}
