// Checks the delivery code scheme (W0-3): 6-digit HMAC (hmac_v1, key OTP_HMAC_SECRET) for new jobs, and that 4-digit sha256_v1 jobs
// already in flight still verify. No database needed. Run from frontend/:  npx tsx scripts/delivery-otp-checks.ts
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];
let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => {
  if (!ok) { console.error(`FAIL  ${what}`, detail === undefined ? '' : JSON.stringify(detail)); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
};

async function main() {
  const { createDeliveryOtp, NEW_SCHEME, NEW_DIGITS } = await import('../server/delivery-otp');
  const { sha256 } = await import('../server/http');
  const ORDER = '3b0f5b9e-8f55-4a52-9d57-2d6f4c0c1a01';
  // Test values only, built here; not real secrets.
  process.env.OTP_HMAC_SECRET = 'test-hmac-secret-for-checks-only';
  const o = createDeliveryOtp(() => 'test-legacy-secret-for-checks');

  const code = await o.deliveryOtp(ORDER);
  check('new orders get a 6-digit code', /^\d{6}$/.test(code) && NEW_DIGITS === 6 && NEW_SCHEME === 'hmac_v1', code);
  check('the same order always gives the same code', code === await o.deliveryOtp(ORDER));
  const codes = new Set(await Promise.all(Array.from({ length: 30 }, (_, i) => o.deliveryOtp(`3b0f5b9e-8f55-4a52-9d57-2d6f4c0c1a${String(i).padStart(2, '0')}`))));
  check('different orders give different codes', codes.size >= 28, codes.size);
  const hash = await o.otpHash(ORDER, code, 'hmac_v1');
  check('the stored verifier is a keyed hash: not the code, not the bare sha256', hash.length === 64 && hash !== code && hash !== await sha256(`${code}:${ORDER}`));
  process.env.OTP_HMAC_SECRET = 'another-secret-for-checks-only';
  check('a different OTP_HMAC_SECRET gives a different code and verifier', await o.deliveryOtp(ORDER) !== code || await o.otpHash(ORDER, code, 'hmac_v1') !== hash);
  process.env.OTP_HMAC_SECRET = 'test-hmac-secret-for-checks-only';

  const job = { ol_order_id: ORDER, otp_hash: hash, otp_scheme: 'hmac_v1', otp_digits: 6 };
  const right = await o.verifyDeliveryCode(job, code);
  check('the right 6-digit code verifies and hands the database the stored verifier', right.ok && right.hash === hash);
  const wrong = code === '000000' ? '000001' : '000000';
  const miss = await o.verifyDeliveryCode(job, wrong);
  check('a wrong code does not verify; the database gets the wrong code\'s own hash so it counts the miss', !miss.ok && miss.hash !== hash && miss.hash === await o.otpHash(ORDER, wrong, 'hmac_v1'));
  check('a 4-digit code never verifies against a 6-digit job', !(await o.verifyDeliveryCode(job, code.slice(0, 4))).ok);
  check('a job with no verifier never verifies', !(await o.verifyDeliveryCode({ ...job, otp_hash: null }, code)).ok);
  check('an hmac_v1 verifier does not verify under a different secret', !(await (async () => { process.env.OTP_HMAC_SECRET = 'rotated-secret-for-checks-only'; const r = await o.verifyDeliveryCode(job, code); process.env.OTP_HMAC_SECRET = 'test-hmac-secret-for-checks-only'; return r.ok; })()));

  // Jobs created before 6 digits: sha256_v1, 4 digits, still valid.
  const legacyCode = await o.deliveryOtp(ORDER, { scheme: 'sha256_v1', digits: 4 });
  check('a legacy job\'s customer code stays 4 digits', /^\d{4}$/.test(legacyCode), legacyCode);
  const legacyJob = { ol_order_id: ORDER, otp_hash: await sha256(`${legacyCode}:${ORDER}`), otp_scheme: 'sha256_v1', otp_digits: 4 };
  check('a sha256_v1 job still verifies with its 4-digit code', (await o.verifyDeliveryCode(legacyJob, legacyCode)).ok);
  check('...and refuses a wrong one', !(await o.verifyDeliveryCode(legacyJob, legacyCode === '0000' ? '0001' : '0000')).ok);
  check('a job row without otp_scheme (old row shape) is treated as legacy', (await o.verifyDeliveryCode({ ol_order_id: ORDER, otp_hash: legacyJob.otp_hash }, legacyCode)).ok);
  const interim = { ol_order_id: ORDER, otp_hash: await (await import('../server/http')).hmacHex('test-legacy-secret-for-checks', `otp-verifier:${ORDER}:${legacyCode}`), otp_scheme: 'sha256_v1', otp_digits: 4 };
  check('a legacy job stored with the interim keyed 4-digit verifier still verifies', (await o.verifyDeliveryCode(interim, legacyCode)).ok);

  // Production needs OTP_HMAC_SECRET.
  const env = process.env as Record<string, string | undefined>;
  const before = env.NODE_ENV, as = { scheme: 'hmac_v1' as const, digits: 6 };
  env.NODE_ENV = 'production'; delete env.OTP_HMAC_SECRET;
  let status = 0; try { await o.deliveryOtp(ORDER, as); } catch (e: any) { status = e.status; }
  check('production without OTP_HMAC_SECRET refuses (503), it does not fall back', status === 503 && status !== 0, status);
  env.OTP_HMAC_SECRET = 'prod-secret-for-checks-only';
  check('production with OTP_HMAC_SECRET works', /^\d{6}$/.test(await o.deliveryOtp(ORDER, as)));
  env.NODE_ENV = before; delete env.OTP_HMAC_SECRET;
  check('outside production a local setup falls back to the legacy secret (no extra value to set)', /^\d{6}$/.test(await o.deliveryOtp(ORDER)));
  console.log(`${passed} checks passed`);
}
main().catch(e => { console.error(e); process.exit(1); });
