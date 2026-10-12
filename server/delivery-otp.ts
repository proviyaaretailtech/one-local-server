// The delivery code (W0-3, P-057): what the customer is told, what is stored on the job, how a typed code is checked.
//
//   hmac_v1    6 digits. Code and stored verifier are HMAC-SHA256 values keyed with the server secret OTP_HMAC_SECRET
//              (a name only: the value lives in the server environment, never in the repo or the database).
//              Required in production. Outside production it falls back to the legacy secret so a local setup needs one value less.
//   sha256_v1  legacy, 4 digits: sha256(code:order), and the interim keyed 4-digit verifier. Jobs already in flight keep verifying.
//
// Each job records its scheme and digit count (delivery_jobs.otp_scheme / otp_digits, migration 0206); verification follows the JOB's
// scheme, never the server's current default.
import { db, dbConfigured } from './db';
import { HttpError, hmacHex, sha256 } from './http';

const isProduction = () => process.env.NODE_ENV === 'production';
// Both sides are hashed first, so the comparison time does not depend on where the strings differ.
const constantTimeEqual = async (a: string, b: string) => (await hmacHex('compare', a)) === (await hmacHex('compare', b));

export type OtpScheme = 'hmac_v1' | 'sha256_v1';
export const NEW_SCHEME: OtpScheme = 'hmac_v1';
export const NEW_DIGITS = 6;
export const LEGACY_DIGITS = 4;

const notConfigured = () => new HttpError(503, 'Dispatch is not set up on this server yet.', undefined, 'not_configured');

export function createDeliveryOtp(legacySecret: () => string) {
  const hmacSecret = () => {
    const s = process.env.OTP_HMAC_SECRET?.trim() ?? '';
    // In production the secret is required and is never the call-signing secret: the services that sign calls must not be able to
    // work out a customer's code. Elsewhere a local setup falls back to the legacy secret.
    if (isProduction()) return s && s !== (process.env.DISPATCH_SIGNING_SECRET?.trim() ?? '') ? s : '';
    return s || legacySecret();
  };
  const need = (s: string) => { if (!s) throw notConfigured(); return s; };

  const digitsOf = (digest: string, digits: number) => String(parseInt(digest.slice(0, 8), 16) % 10 ** digits).padStart(digits, '0');

  // Scheme and digits of the order's job; an order with no job yet gets the new scheme (createJob stores exactly that).
  async function schemeOf(olOrderId: string): Promise<{ scheme: OtpScheme; digits: number }> {
    if (dbConfigured()) {
      const { data } = await db().from('delivery_jobs').select('otp_scheme, otp_digits').eq('ol_order_id', olOrderId).maybeSingle();
      if (data?.otp_scheme === 'sha256_v1') return { scheme: 'sha256_v1', digits: Number(data.otp_digits) || LEGACY_DIGITS };
    }
    return { scheme: NEW_SCHEME, digits: NEW_DIGITS };
  }

  // The code the customer is shown. Derived from the order, never stored.
  async function deliveryOtp(olOrderId: string, as?: { scheme: OtpScheme; digits: number }): Promise<string> {
    const { scheme, digits } = as ?? await schemeOf(olOrderId);
    if (scheme === 'sha256_v1') return digitsOf(await hmacHex(need(legacySecret()), `delivery-otp:${olOrderId}`), digits);
    return digitsOf(await hmacHex(need(hmacSecret()), `delivery-otp:${olOrderId}`), digits);
  }

  // The verifier stored on the job.
  async function otpHash(olOrderId: string, code: string, scheme: OtpScheme = NEW_SCHEME): Promise<string> {
    if (scheme === 'sha256_v1') return sha256(`${code}:${olOrderId}`);
    return hmacHex(need(hmacSecret()), `otp-verifier:${olOrderId}:${code}`);
  }

  // Compares the typed code with the job's verifier in constant time. Returns the value to hand the database as the code's hash:
  // the stored verifier on a match (the database accepts it), the typed code's hash otherwise (the database counts the miss, so
  // five wrong codes still lock the job). A code of the wrong length is a miss.
  async function verifyDeliveryCode(job: { ol_order_id: string; otp_hash?: string | null; otp_scheme?: string | null; otp_digits?: number | null }, code: string): Promise<{ ok: boolean; hash: string }> {
    const stored = String(job.otp_hash ?? '');
    const scheme: OtpScheme = job.otp_scheme === 'hmac_v1' ? 'hmac_v1' : 'sha256_v1';
    const digits = Number(job.otp_digits) || (scheme === 'hmac_v1' ? NEW_DIGITS : LEGACY_DIGITS);
    const candidate = await otpHash(job.ol_order_id, code, scheme);
    let match = false;
    if (scheme === 'hmac_v1') match = await constantTimeEqual(stored, candidate);
    else {
      const interim = legacySecret() ? await hmacHex(legacySecret(), `otp-verifier:${job.ol_order_id}:${code}`) : '';
      const [a, b] = await Promise.all([constantTimeEqual(stored, candidate), constantTimeEqual(stored, interim)]);
      match = a || b;
    }
    const ok = !!stored && code.length === digits && match;
    return { ok, hash: ok ? stored : candidate };
  }

  return { deliveryOtp, otpHash, verifyDeliveryCode, schemeOf };
}
