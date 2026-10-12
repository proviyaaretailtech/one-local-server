// Checks the dispatch edge with no database: the service credential (token, timestamp, signature), the
// job payload rules, the delivery code, what a rider may see before and after pickup, and that the rider
// routes refuse anyone who is not signed in. The database half (one job per order, one winner, offers
// moving on) is rehearsed in SQL: db/tests/0029_dispatch_scenario.sql.
// Run from frontend/:  npx tsx scripts/dispatch-checks.ts
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];

let passed = 0;
function check(what: string, ok: boolean, detail?: unknown) {
  if (!ok) { console.error(`FAIL  ${what}`, detail ?? ''); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
}
const statusOf = async (run: () => Promise<Response>) => { const r = await run(); return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) as any }; };

const TOKEN = 'service-token-for-checks', SECRET = 'signing-secret-for-checks';
const ORDER = '3b0f5b9e-8f55-4a52-9d57-2d6f4c0c1a11', ORG = '9c1e1f3a-1f0e-4d0c-9c49-1b0a5b0d2e22', OTHER_ORG = '5d7f2b1c-6a4e-4c8e-8b3a-0e1d2c3b4a55';

const jobBody = (over: Record<string, unknown> = {}) => ({
  ol_order_id: ORDER, pos_order_id: null, organization_id: ORG, order_no: 'A-1042', payment_mode: 'cod', cash_to_collect: 460,
  items: { count: 4, temperature: 'hot' }, prep_minutes: 20, promised_by: '2026-10-02T19:45:00+05:30',
  pickup: { name: 'Mysore Dining Hall', address: 'Main Road', lat: 18.4088, lng: 76.5604, phone: '+910000000000' },
  drop: { area: 'Gandhi Chowk', address: 'Flat 4, Gandhi Chowk', lat: 18.4001, lng: 76.5702, customer_first_name: 'Asha', customer_phone: '+911111111111' },
  vehicle: 'any', dispatch_trigger: 'placed', ...over,
});

async function main() {
  const { hmacHex, sha256, clientIp, constantTimeEqual } = await import('../server/http');
  const dispatch = await import('../server/dispatch');
  const eventsRoute = await import('../app/api/dispatch/events+api');
  const jobRoute = await import('../app/api/dispatch/jobs/[id]+api');
  const jobs = await import('../app/api/dispatch/jobs/index+api');
  const cancel = await import('../app/api/dispatch/jobs/[id]/cancel+api');
  const sweepRoute = await import('../app/api/dispatch/sweep+api');
  const offers = await import('../app/api/rider/offers/current+api');
  const accept = await import('../app/api/rider/offers/[id]/accept+api');
  const availability = await import('../app/api/rider/availability+api');

  // X-Signature = HMAC-SHA256(secret, METHOD \n path?query \n timestamp \n sha256(raw body)): written out here the way docs/RIDER_DISPATCH_API.md says,
  // not taken from the server, so a change in the server's idea of what is signed shows up as a failure. `signFor` signs some other request.
  const signingString = async (method: string, pathAndQuery: string, stamp: string, raw: string) => `${method}\n${pathAndQuery}\n${stamp}\n${await sha256(raw)}`;
  type Opts = { token?: string; stamp?: string; sign?: string; requestId?: string | null; key?: string | null; method?: string; signFor?: { method?: string; url?: string; raw?: string } };
  async function signed(url: string, body: unknown, o: Opts = {}) {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const stamp = o.stamp ?? String(Math.floor(Date.now() / 1000));
    const method = o.method ?? (body === undefined ? 'GET' : 'POST');
    const over = o.signFor ?? {};
    const sig = await hmacHex(SECRET, await signingString(over.method ?? method, `/api/${over.url ?? url}`, stamp, over.raw ?? raw));
    const headers: Record<string, string> = { authorization: `Bearer ${o.token ?? TOKEN}`, 'x-timestamp': stamp, 'x-signature': o.sign ?? sig };
    if (o.requestId !== null) headers['x-request-id'] = o.requestId ?? 'req-1';
    // A key names one request (the server refuses to reuse it for another), so each different body gets its own key.
    if (o.key !== null && body !== undefined) headers['idempotency-key'] = o.key ?? `onelocal:${ORDER}:${(await sha256(`${url}:${raw}`)).slice(0, 12)}`;
    return new Request(`http://localhost/api/${url}`, { method: o.method ?? (body === undefined ? 'GET' : 'POST'), headers, body: raw || undefined });
  }
  const post = async (body: unknown, o?: Opts) => statusOf(async () => jobs.POST(await signed('dispatch/jobs', body, o), {}));

  // ---------- Not set up ----------
  let r = await post(jobBody());
  check('no credential configured: 503 not_configured', r.status === 503 && r.body?.code === 'not_configured', r);

  Object.assign(process.env, { DISPATCH_SERVICE_TOKEN: TOKEN, DISPATCH_SIGNING_SECRET: SECRET });

  // ---------- The service credential ----------
  r = await post(jobBody());
  check('a signed call passes the credential and reaches the database (503 here: none connected)', r.status === 503 && /database/i.test(r.body?.detail), r);
  r = await post(jobBody(), { token: 'a-user-jwt.eyJzdWIiOiJ1c2VyIn0.signature-of-some-user' });
  check("a user's token is refused", r.status === 401 && r.body?.code === 'unauthorized', r);
  r = await statusOf(async () => jobs.POST(new Request('http://localhost/api/dispatch/jobs', { method: 'POST', body: '{}' }), {}));
  check('no credential at all is refused', r.status === 401, r);
  r = await post(jobBody(), { stamp: String(Math.floor(Date.now() / 1000) - 600) });
  check('a request older than 5 minutes is refused', r.status === 401 && r.body?.code === 'stale_request', r);
  r = await post(jobBody(), { stamp: new Date().toISOString() });
  check('an ISO timestamp is accepted', r.status === 503, r);
  r = await post(jobBody(), { sign: '0'.repeat(64) });
  check('a wrong signature is refused', r.status === 401 && r.body?.code === 'bad_signature', r);
  const tampered = await signed('dispatch/jobs', jobBody());
  r = await statusOf(async () => jobs.POST(new Request(tampered.url, { method: 'POST', headers: tampered.headers, body: JSON.stringify(jobBody({ cash_to_collect: 1 })) }), {}));
  check('a body changed after signing is refused', r.status === 401 && r.body?.code === 'bad_signature', r);
  // The signature is bound to the request it was made for (SRV-6): method, path and query, timestamp, body hash.
  const old = jobBody(); const oldRaw = JSON.stringify(old); const oldStamp = String(Math.floor(Date.now() / 1000));
  r = await statusOf(async () => jobs.POST(new Request('http://localhost/api/dispatch/jobs', { method: 'POST', body: oldRaw, headers: { authorization: `Bearer ${TOKEN}`, 'x-timestamp': oldStamp, 'x-request-id': 'req-1', 'idempotency-key': 'old-format-0001', 'x-signature': await hmacHex(SECRET, `${oldStamp}.${oldRaw}`) } }), {}));
  check('the old signature (timestamp.body only) is refused', r.status === 401 && r.body?.code === 'bad_signature', r);
  r = await statusOf(async () => cancel.POST(await signed('dispatch/jobs/x/cancel', { reason: 'customer_cancelled' }, { signFor: { url: 'dispatch/jobs/y/cancel' } }), { id: ORDER }));
  check('a signature made for another path is refused', r.status === 401 && r.body?.code === 'bad_signature', r);
  r = await statusOf(async () => cancel.POST(await signed('dispatch/jobs/x/cancel', { reason: 'customer_cancelled' }, { signFor: { method: 'PUT' } }), { id: ORDER }));
  check('a signature made for another method is refused', r.status === 401 && r.body?.code === 'bad_signature', r);
  r = await statusOf(async () => cancel.POST(await signed('dispatch/jobs/x/cancel', { reason: 'customer_cancelled' }, { signFor: { raw: JSON.stringify({ reason: 'other' }) } }), { id: ORDER }));
  check('a signature made for another body is refused', r.status === 401 && r.body?.code === 'bad_signature', r);
  const getSig = await signed(`dispatch/jobs/${ORDER}`, undefined);
  r = await statusOf(async () => eventsRoute.GET(new Request('http://localhost/api/dispatch/events?after=0', { method: 'GET', headers: getSig.headers }), {}));
  check("a captured GET signature does not open another GET (it used to, for five minutes)", r.status === 401 && r.body?.code === 'bad_signature', r);
  r = await statusOf(async () => jobRoute.GET(new Request(getSig.url, { method: 'GET', headers: getSig.headers }), { id: ORDER }));
  check('the same GET signature still works for the call it was made for', r.status === 503, r);
  const queryRead = await signed('dispatch/events?after=0&limit=5', undefined);
  r = await statusOf(async () => eventsRoute.GET(new Request('http://localhost/api/dispatch/events?after=0&limit=500', { method: 'GET', headers: queryRead.headers }), {}));
  check('the query string is signed too', r.status === 401 && r.body?.code === 'bad_signature', r);
  const future = await post(jobBody(), { stamp: String(Math.floor(Date.now() / 1000) + 600) });
  check('a timestamp too far in the future is refused too', future.status === 401 && future.body?.code === 'stale_request', future);
  r = await statusOf(async () => cancel.POST(await signed('dispatch/jobs/x/cancel', { reason: 'customer_cancelled' }, { key: 'reuse-key-0001' }), { id: ORDER }));
  check('an Idempotency-Key is accepted the first time', r.status === 503, r);
  r = await statusOf(async () => cancel.POST(await signed('dispatch/jobs/x/cancel', { reason: 'restaurant_rejected' }, { key: 'reuse-key-0001' }), { id: ORDER }));
  check('the same Idempotency-Key for a different request: 422 idempotency_mismatch', r.status === 422 && r.body?.code === 'idempotency_mismatch', r);
  r = await statusOf(async () => cancel.POST(await signed('dispatch/jobs/x/cancel', { reason: 'customer_cancelled' }, { key: 'reuse-key-0001' }), { id: ORDER }));
  check('the same key for the same request (a retry) is still accepted', r.status === 503, r);

  r = await post(jobBody(), { requestId: null });
  check('X-Request-Id is required', r.status === 400 && r.body?.code === 'invalid_request', r);
  r = await post(jobBody(), { key: null });
  check('Idempotency-Key is required on a POST', r.status === 400 && r.body?.code === 'invalid_request', r);
  r = await statusOf(async () => cancel.POST(await signed('dispatch/jobs/x/cancel', { reason: 'customer_cancelled' }), { id: ORDER }));
  check('cancel passes the same credential (then needs the database)', r.status === 503, r);
  r = await statusOf(async () => cancel.POST(await signed('dispatch/jobs/x/cancel', { reason: 'because' }), { id: ORDER }));
  check('cancel refuses an unknown reason', r.status === 400 && r.body?.code === 'invalid_payload', r);
  r = await statusOf(async () => sweepRoute.POST(await signed('dispatch/sweep', {}, { key: 'sweep-0001-aaaa' }), {}));
  check('the sweep passes the credential too', r.status === 503, r);

  // ---------- Which restaurants a credential may dispatch for ----------
  process.env.DISPATCH_ALLOWED_ORGS = ORG;
  r = await post(jobBody({ organization_id: OTHER_ORG }));
  check('another organization is refused (403 organization_not_allowed)', r.status === 403 && r.body?.code === 'organization_not_allowed', r);
  r = await post(jobBody({ organization_id: null }));
  check('a store with no merchant is refused unless * is allowed', r.status === 403, r);
  r = await post(jobBody());
  check('the allowed organization passes', r.status === 503, r);
  process.env.DISPATCH_ALLOWED_ORGS = `${ORG},*`;
  r = await post(jobBody({ organization_id: null }));
  check('with * a store with no merchant passes', r.status === 503, r);
  // Every route honours the allow-list, not only job creation (SRV-6). A restricted credential cannot run the sweep, and reads of a
  // job or the events feed need the database to find the job's organization (here: none connected, so 503 rather than an answer).
  process.env.DISPATCH_ALLOWED_ORGS = ORG;
  r = await statusOf(async () => sweepRoute.POST(await signed('dispatch/sweep', {}, { key: 'sweep-0002-aaaa' }), {}));
  check('a credential limited to some organizations cannot run the sweep: 403', r.status === 403 && r.body?.code === 'organization_not_allowed', r);
  r = await statusOf(async () => jobRoute.GET(await signed(`dispatch/jobs/${ORDER}`, undefined), { id: ORDER }));
  check('a limited credential reading a job goes through the organization check (needs the database)', r.status === 503, r);
  r = await statusOf(async () => jobRoute.GET(await signed('dispatch/jobs/not-a-uuid', undefined), { id: 'not-a-uuid' }));
  check('a limited credential asking for an id that is not a job: 404, like a job that is not its own', r.status === 404 && r.body?.code === 'not_found', r);
  r = await statusOf(async () => cancel.POST(await signed(`dispatch/jobs/${ORDER}/cancel`, { reason: 'customer_cancelled' }, { key: 'scope-cancel-001' }), { id: ORDER }));
  check('cancel is scoped to the credential\'s organizations (needs the database to look the job up)', r.status === 503, r);
  r = await statusOf(async () => eventsRoute.GET(await signed('dispatch/events?after=0', undefined), {}));
  check('the events feed of a limited credential is filtered by organization (needs the database)', r.status === 503, r);
  delete process.env.DISPATCH_ALLOWED_ORGS;
  r = await statusOf(async () => sweepRoute.POST(await signed('dispatch/sweep', {}, { key: 'sweep-0003-aaaa' }), {}));
  check('an unrestricted credential still runs the sweep', r.status === 503, r);

  // ---------- The job payload ----------
  const bad = async (what: string, over: Record<string, unknown>, status = 400, code = 'invalid_payload') => {
    const x = await post(jobBody(over));
    check(what, x.status === status && x.body?.code === code, x);
  };
  await bad('ol_order_id must be a uuid', { ol_order_id: 'A-1042' });
  await bad('payment_mode must be cod or online', { payment_mode: 'cash' });
  await bad('an online order carries no cash', { payment_mode: 'online', cash_to_collect: 100 });
  await bad('cash cannot be negative', { cash_to_collect: -5 });
  await bad('items.count must be a whole number from 1', { items: { count: 0 } });
  await bad('temperature is hot, cold or ambient', { items: { count: 1, temperature: 'lukewarm' } });
  await bad('promised_by must be a date', { promised_by: 'soon' });
  await bad('vehicle must be a known class', { vehicle: 'rocket' });
  await bad('the drop needs coordinates (a rider navigates to a point, not text)', { drop: { area: 'Gandhi Chowk', address: 'text only' } });
  await bad('a restaurant with no map location: 422 no_pickup_location', { pickup: { name: 'Mysore Dining Hall', address: 'Main Road' } }, 422, 'no_pickup_location');
  await bad('a drop outside the delivery area: 422 outside_delivery_area', { drop: { area: 'Pune', lat: 18.5204, lng: 73.8567 } }, 422, 'outside_delivery_area');
  const parsed = dispatch.parseJobPayload(jobBody({ cash_to_collect: 460.456, store_id: ' mcdonalds ' }));
  check('a good payload is accepted and tidied', parsed.cash_to_collect === 460.46 && parsed.store_id === 'mcdonalds' && parsed.pickup.lat === 18.4088 && parsed.dispatch_trigger === 'placed', parsed);

  // ---------- The delivery code ----------
  const code = await dispatch.deliveryOtp(ORDER);
  check('the delivery code is 6 digits (hmac_v1)', /^\d{6}$/.test(code), code);
  check('the same order always gives the same code', code === await dispatch.deliveryOtp(ORDER));
  const codes = new Set(await Promise.all(Array.from({ length: 20 }, (_, i) => dispatch.deliveryOtp(`3b0f5b9e-8f55-4a52-9d57-2d6f4c0c1a${String(i).padStart(2, '0')}`))));
  check('different orders give different codes', codes.size > 10, [...codes]);
  const hash = await dispatch.otpHash(ORDER, code);
  check('the stored hash is not the code and depends on the order', hash !== code && hash.length === 64 && hash !== await dispatch.otpHash('other-order', code));
  check('the stored verifier is keyed: it is not the bare hash anyone could compute for a 4-digit code', hash !== await sha256(`${code}:${ORDER}`));

  // The code is compared with the stored verifier in constant time; the database still counts every miss.
  const verifier = await dispatch.verifyDeliveryCode({ ol_order_id: ORDER, otp_hash: hash, otp_scheme: 'hmac_v1', otp_digits: 6 }, code);
  check('the right code verifies and the stored verifier is what the database is handed', verifier.ok && verifier.hash === hash, verifier);
  const wrong = code === '000000' ? '111111' : '000000';
  const miss = await dispatch.verifyDeliveryCode({ ol_order_id: ORDER, otp_hash: hash, otp_scheme: 'hmac_v1', otp_digits: 6 }, wrong);
  check('a wrong code does not verify and the database is handed the wrong code\'s own hash (so it counts the miss)', !miss.ok && miss.hash === await dispatch.otpHash(ORDER, wrong) && miss.hash !== hash, miss);
  const legacyCode = await dispatch.deliveryOtp(ORDER, { scheme: 'sha256_v1', digits: 4 });
  const legacyJob = await dispatch.verifyDeliveryCode({ ol_order_id: ORDER, otp_hash: await sha256(`${legacyCode}:${ORDER}`), otp_scheme: 'sha256_v1', otp_digits: 4 }, legacyCode);
  check('a job made before the verifier was keyed (bare sha256, 4 digits) still verifies', legacyJob.ok && /^\d{4}$/.test(legacyCode), legacyJob);
  check('a job with no verifier never verifies', !(await dispatch.verifyDeliveryCode({ ol_order_id: ORDER, otp_hash: null }, code)).ok);
  check('constantTimeEqual: equal, different and different-length strings', await constantTimeEqual('abc', 'abc') && !(await constantTimeEqual('abc', 'abd')) && !(await constantTimeEqual('abc', 'abcd')) && !(await constantTimeEqual('', 'x')));

  // The OTP secret is its own secret in production (SRV-6): the services that sign calls must not be able to work out a customer's code.
  const prodEnv = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: 'production' });
  let noSecret: any = null;
  try { await dispatch.deliveryOtp(ORDER, { scheme: 'hmac_v1', digits: 6 }); } catch (e) { noSecret = e; }
  check('in production the code is not derived from the signing secret: 503 not_configured without OTP_HMAC_SECRET', noSecret?.status === 503 && noSecret?.code === 'not_configured', noSecret);
  process.env.OTP_HMAC_SECRET = SECRET;
  noSecret = null;
  try { await dispatch.deliveryOtp(ORDER, { scheme: 'hmac_v1', digits: 6 }); } catch (e) { noSecret = e; }
  check('in production an OTP secret equal to the signing secret is refused too', noSecret?.status === 503, noSecret);
  process.env.OTP_HMAC_SECRET = 'a-separate-otp-secret-for-checks';
  const prodCode = await dispatch.deliveryOtp(ORDER, { scheme: 'hmac_v1', digits: 6 });
  check('in production a separate OTP_HMAC_SECRET works, and the code differs from the one the signing secret would give', /^\d{6}$/.test(prodCode) && (await dispatch.otpHash(ORDER, prodCode)) !== hash);
  delete process.env.OTP_HMAC_SECRET;
  if (prodEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else process.env.NODE_ENV = prodEnv;

  // The caller's address is the one a trusted proxy saw, never what the client wrote first in X-Forwarded-For (SRV-7).
  const withHeaders = (h: Record<string, string>) => new Request('http://localhost/api/x', { headers: h });
  delete process.env.TRUSTED_PROXY_HOPS;
  check('outside production no address header is believed', clientIp(withHeaders({ 'x-forwarded-for': '6.6.6.6' })) === 'direct');
  process.env.TRUSTED_PROXY_HOPS = '1';
  check('behind one trusted proxy the last entry counts, not the one the client wrote first', clientIp(withHeaders({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' })) === '203.0.113.9');
  check('two trusted hops: the second from the right', clientIp(Object.assign(withHeaders({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.0.0.2' }), {})) === '10.0.0.2' && (process.env.TRUSTED_PROXY_HOPS = '2') === '2' && clientIp(withHeaders({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.0.0.2' })) === '203.0.113.9');
  process.env.TRUSTED_PROXY_HOPS = '1';
  check('a garbage address is not used', clientIp(withHeaders({ 'x-forwarded-for': 'not an ip' })) === 'direct');
  delete process.env.TRUSTED_PROXY_HOPS;

  // ---------- What a rider sees ----------
  const row = (status: string) => ({
    id: 'job-1', order_no: 'A-1042', status, version: 3, pickup_name: 'Mysore Dining Hall', pickup_address: 'Main Road', pickup_lat: 18.4088, pickup_lng: 76.5604, pickup_phone: '+910000000000',
    drop_area: 'Gandhi Chowk', drop_address: 'Flat 4, Gandhi Chowk', drop_lat: 18.40017, drop_lng: 76.57023, drop_notes: 'Ring twice', customer_first_name: 'Asha', customer_phone: '+911111111111',
    items_count: 4, temperature: 'hot', cash_to_collect: '460.00', promised_by: null, otp_hash: 'secret-hash',
  });
  const offered = dispatch.riderJob(row('offered'));
  check('an offered job shows the area and the restaurant, no street address and no phones', offered.drop.area === 'Gandhi Chowk' && offered.drop.address === null && offered.drop.customer_phone === null && offered.pickup.address === null && offered.pickup.phone === null, offered);
  check('before pickup the drop point is rounded to about a kilometre', offered.drop.lat === 18.4 && offered.drop.lng === 76.57, offered.drop);
  const assigned = dispatch.riderJob(row('assigned'), { lat: 18.41, lng: 76.56 });
  check('once assigned the rider gets the pickup address and the customer first name and phone, still not the address', assigned.pickup.address === 'Main Road' && assigned.drop.customer_phone === '+911111111111' && assigned.drop.address === null && assigned.drop.instructions === null, assigned);
  check('an assigned job carries the ETA to pickup', (assigned.eta?.to_pickup_min ?? 0) >= 1, assigned.eta);
  const picked = dispatch.riderJob(row('picked_up'));
  check('after pickup the full address, exact point and instructions appear', picked.drop.address === 'Flat 4, Gandhi Chowk' && picked.drop.lat === 18.40017 && picked.drop.instructions === 'Ring twice', picked.drop);
  const delivered = dispatch.riderJob(row('delivered'));
  check('after delivery the customer phone disappears again', delivered.drop.customer_phone === null);
  check('the delivery code never reaches the rider', !JSON.stringify([offered, assigned, picked, delivered]).includes('secret-hash'));
  check('cash to collect is a number, and no item prices are exposed', assigned.cash_to_collect === 460 && !('items' in assigned) && !('total' in assigned));

  // ---------- Rider routes need a signed-in rider ----------
  r = await statusOf(async () => offers.GET(new Request('http://localhost/api/rider/offers/current'), {}));
  check('offers/current refuses a caller who is not signed in', r.status === 401, r);
  r = await statusOf(async () => accept.POST(new Request('http://localhost/api/rider/offers/x/accept', { method: 'POST', headers: { authorization: 'Bearer short' } }), { id: 'x' }));
  check('accepting an offer refuses a bad token', r.status === 401, r);
  r = await statusOf(async () => availability.POST(new Request('http://localhost/api/rider/availability', { method: 'POST', body: '{"online":true}' }), {}));
  check('going online refuses a caller who is not signed in', r.status === 401, r);

  // ---------- The order flow never breaks an order ----------
  let threw = false;
  try { await dispatch.dispatchOrders([ORDER]); } catch { threw = true; }
  check('with no database, dispatchOrders does nothing and does not throw', !threw);

  console.log(`\n${passed} checks passed`);
}
main().catch(e => { console.error(e); process.exit(1); });
