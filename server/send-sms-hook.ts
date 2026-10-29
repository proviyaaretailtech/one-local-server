/// <reference types="node" />
// Supabase Auth "Send SMS" hook: when a customer asks for a sign-in code, Supabase makes the code itself and calls
// POST /api/auth/send-sms (instead of texting through Twilio). This file proves the call really came from Supabase
// (Standard Webhooks signature, key SEND_SMS_HOOK_SECRET) and hands the code to APITxT to text. Supabase keeps the
// code and checks it when the customer types it back, so nothing is stored here and there is nothing to verify here.
import crypto from 'node:crypto';
import { HttpError, limit, redact } from './http';

const APITXT_URL = 'https://apitxt.com/api/sendOTP';
const TOLERANCE_S = 5 * 60; // a signed call older (or newer) than this is a replay
type Env = Record<string, string | undefined>;
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

// Supabase shows the secret as `v1,whsec_<base64>`; the signing key is the decoded base64.
function signingKey(secret: string): Buffer {
  return Buffer.from(secret.replace(/^v1,/, '').replace(/^whsec_/, ''), 'base64');
}

/** True when `signatures` (the webhook-signature header: "v1,<base64> v1,<base64>") holds a valid signature for this call. */
export function signatureValid(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, nowMs = Date.now()): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const sent = Number(timestamp);
  if (!Number.isFinite(sent) || Math.abs(nowMs / 1000 - sent) > TOLERANCE_S) return false;
  const expected = crypto.createHmac('sha256', signingKey(secret)).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(' ').some(part => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

/** `91XXXXXXXXXX` for an Indian mobile number in any of the usual spellings; null for anything else (the app only serves India). */
export function indianMobile(phone: unknown): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  const national = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(national) ? `91${national}` : null;
}

const refuse = (status: number, message: string) => Response.json({ error: { http_code: status, message } }, { status });
const masked = (mobile: string) => `${mobile.slice(0, 4)}XXXXXX${mobile.slice(-2)}`;

export async function sendSmsHook(request: Request, body: string, env: Env = process.env, send: Fetch = fetch as unknown as Fetch): Promise<Response> {
  const secret = env.SEND_SMS_HOOK_SECRET; const authkey = env.APITXT_AUTH_KEY;
  if (!secret || !authkey) { console.error('[send-sms] SEND_SMS_HOOK_SECRET or APITXT_AUTH_KEY is not set'); return refuse(503, 'SMS sending is not set up.'); }
  const h = request.headers;
  if (!signatureValid(secret, { id: h.get('webhook-id'), timestamp: h.get('webhook-timestamp'), signature: h.get('webhook-signature') }, body)) return refuse(401, 'Invalid signature.');

  let payload: { user?: { phone?: string }; sms?: { otp?: string } };
  try { payload = JSON.parse(body); } catch { return refuse(400, 'Body must be JSON.'); }
  const mobile = indianMobile(payload.user?.phone); const otp = String(payload.sms?.otp ?? '');
  if (!mobile) return refuse(422, 'Only Indian mobile numbers can receive a code.');
  if (!/^\d{4,10}$/.test(otp)) return refuse(400, 'No code to send.');
  try { limit(mobile, 'send-sms-hook', 5, 10 * 60 * 1000); } // Supabase has its own limits; this stops one number being texted over and over
  catch (error) { if (error instanceof HttpError) return refuse(error.status, error.detail); throw error; }

  const form = new URLSearchParams({ authkey, mobile, otp });
  if (env.APITXT_TEMPLATE_ID) form.set('template_id', env.APITXT_TEMPLATE_ID); // the approved DLT template, when APITxT is told which
  try {
    const response = await send(APITXT_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    let result: { status?: string; message?: string } = {};
    try { result = JSON.parse(text); } catch { /* not JSON: treated as a failure below */ }
    if (response.ok && result.status === 'success') return Response.json({});
    // Never log the code or the key; the number is masked.
    console.error('[send-sms] APITxT refused', masked(mobile), response.status, redact(result.message ?? text.slice(0, 200)));
    return refuse(502, 'The code could not be sent. Please try again.');
  } catch (error) {
    console.error('[send-sms] APITxT unreachable', masked(mobile), redact(error));
    return refuse(502, 'The code could not be sent. Please try again.');
  }
}
