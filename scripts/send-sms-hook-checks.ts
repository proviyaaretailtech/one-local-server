// Checks the Supabase "Send SMS" hook (server/send-sms-hook.ts) with a fake APITxT: no real SMS, no network, no database.
// Run from frontend/:  npx tsx scripts/send-sms-hook-checks.ts
import crypto from 'node:crypto';
let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => {
  if (!ok) { console.error(`FAIL  ${what}`, detail === undefined ? '' : JSON.stringify(detail)); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
};

async function main() {
  const { sendSmsHook, signatureValid, indianMobile } = await import('../server/send-sms-hook');
  // Test values only, made here; not the real secrets.
  const key = crypto.randomBytes(24);
  const env = { SEND_SMS_HOOK_SECRET: `v1,whsec_${key.toString('base64')}`, APITXT_AUTH_KEY: 'test-authkey-for-checks' };
  const sign = (id: string, ts: number, body: string, k = key) => `v1,${crypto.createHmac('sha256', k).update(`${id}.${ts}.${body}`).digest('base64')}`;
  const now = () => Math.floor(Date.now() / 1000);
  const body = (phone: string, otp = '482913') => JSON.stringify({ user: { id: 'u1', phone }, sms: { otp } });
  const call = (b: string, over: { id?: string; ts?: number; sig?: string } = {}, e: Record<string, string | undefined> = env, fake?: Parameters<typeof sendSmsHook>[3]) => {
    const id = over.id ?? 'msg_1'; const ts = over.ts ?? now();
    const req = new Request('http://localhost/api/auth/send-sms', { method: 'POST', headers: { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': over.sig ?? sign(id, ts, b) }, body: b });
    return sendSmsHook(req, b, e, fake);
  };
  type Sent = { url: string; form: URLSearchParams };
  const sent: Sent[] = [];
  const ok = async (url: string, init: { body: string }) => { sent.push({ url, form: new URLSearchParams(init.body) }); return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'success', message: 'Sms OTP Sent Successfully' }) }; };

  // Number spellings.
  check('Indian numbers normalise to 91XXXXXXXXXX', ['+919876543210', '919876543210', '9876543210'].every(p => indianMobile(p) === '919876543210'));
  check('foreign, short and non-mobile numbers are refused', [null, '+14155550123', '12345', '+915876543210', '+9198765432101'].every(p => indianMobile(p) === null));

  // Signature.
  const b = body('+919876543210'); const t = now();
  check('a correct signature is accepted', signatureValid(env.SEND_SMS_HOOK_SECRET, { id: 'm', timestamp: String(t), signature: sign('m', t, b) }, b));
  check('a signature made with another key is refused', !signatureValid(env.SEND_SMS_HOOK_SECRET, { id: 'm', timestamp: String(t), signature: sign('m', t, b, crypto.randomBytes(24)) }, b));
  check('a changed body is refused', !signatureValid(env.SEND_SMS_HOOK_SECRET, { id: 'm', timestamp: String(t), signature: sign('m', t, b) }, body('+919999999999')));
  check('an old (replayed) call is refused', !signatureValid(env.SEND_SMS_HOOK_SECRET, { id: 'm', timestamp: String(t - 3600), signature: sign('m', t - 3600, b) }, b));
  check('missing headers are refused', !signatureValid(env.SEND_SMS_HOOK_SECRET, { id: null, timestamp: null, signature: null }, b));
  check('one good signature among several is accepted', signatureValid(env.SEND_SMS_HOOK_SECRET, { id: 'm', timestamp: String(t), signature: `v1,AAAA ${sign('m', t, b)}` }, b));

  // The whole call.
  let r = await call(b, {}, env, ok);
  check('a signed call sends the code to APITxT and answers 200 {}', r.status === 200 && JSON.stringify(await r.json()) === '{}' && sent.length === 1, r.status);
  check('APITxT gets authkey, 91-number and the code, as a form', sent[0]?.url === 'https://apitxt.com/api/sendOTP' && sent[0].form.get('authkey') === 'test-authkey-for-checks' && sent[0].form.get('mobile') === '919876543210' && sent[0].form.get('otp') === '482913' && !sent[0].form.has('template_id'));
  await call(body('+919123456780'), {}, { ...env, APITXT_TEMPLATE_ID: '42' }, ok);
  check('APITXT_TEMPLATE_ID, when set, is passed on', sent[1]?.form.get('template_id') === '42');

  const before = sent.length;
  r = await call(b, { sig: 'v1,AAAA' }, env, ok);
  check('a bad signature is a 401 and nothing is sent', r.status === 401 && sent.length === before);
  r = await call(body('+14155550123'), {}, env, ok);
  check('a foreign number is a 422 and nothing is sent', r.status === 422 && sent.length === before);
  r = await call(body('+919876500001', 'abc'), {}, env, ok);
  check('a missing or odd code is a 400 and nothing is sent', r.status === 400 && sent.length === before);
  r = await call(b, {}, { SEND_SMS_HOOK_SECRET: env.SEND_SMS_HOOK_SECRET }, ok);
  check('no APITXT_AUTH_KEY is a 503 and nothing is sent', r.status === 503 && sent.length === before);
  r = await call(b, {}, { APITXT_AUTH_KEY: 'x' }, ok);
  check('no SEND_SMS_HOOK_SECRET is a 503 (never accepts unsigned calls)', r.status === 503 && sent.length === before);

  const quiet = console.error; console.error = () => {};
  r = await call(body('+919876500002'), {}, env, async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ status: 'error', message: 'DLT template not approved' }) }));
  const failed = await r.json() as { error?: { message?: string } };
  check('APITxT refusing (DLT, key) is a 502 with no provider detail leaked', r.status === 502 && !JSON.stringify(failed).includes('DLT'), failed);
  r = await call(body('+919876500003'), {}, env, async () => { throw new Error('connect ETIMEDOUT'); });
  check('APITxT unreachable is a 502', r.status === 502);
  r = await call(body('+919876500004'), {}, env, async () => ({ ok: true, status: 200, text: async () => '<html>oops</html>' }));
  check('a 200 that is not "success" counts as failed', r.status === 502);
  console.error = quiet;

  const n = '+919876500009'; let last = 200;
  for (let i = 0; i < 7; i++) last = (await call(body(n), { id: `m${i}` }, env, ok)).status;
  check('the same number cannot be texted more than 5 times in 10 minutes', last === 429, last);

  console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
}
main().catch(e => { console.error(e); process.exit(1); });
