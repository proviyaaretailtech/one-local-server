// Cashfree checkout, webhook and refunds against a FAKE Cashfree (globalThis.fetch stubbed: nothing here can reach the network).
// Part A (no database, memory mode): methods, order create, UPI intent/QR/collect, status poll, webhook good/bad signature/stale/replayed/duplicate,
//   success / failed / dropped / pending, amount mismatch, forward-only state, switch to cash.
// Part B (LOCAL Supabase from .env.localdb.off): partial and full refund, deterministic refund id, double refund prevented, over-refund refused,
//   pending -> webhook SUCCESS, rejected -> failed and visible to the queue, cash orders never hit the gateway. Cleans up after itself.
// Run from frontend/:  npx tsx scripts/cashfree-checks.ts   (part B needs frontend/.env.localdb.off and the local stack running)
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const localEnv: Record<string, string> = {};
for (const line of readFileSync(`${process.cwd()}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) localEnv[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(localEnv.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'FEATURE_ONLINE_PAYMENTS', 'ALLOW_REMOTE', 'TRUSTED_PROXY_HOPS', 'ORDERS_REQUIRE_SIGN_IN', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'COD_MAX_TOTAL', 'FEATURE_COD']) delete process.env[k];
const RUN = randomBytes(3).toString('hex');
const SECRET = 'cfsk_ma_test_FAKE_checks_secret';
Object.assign(process.env, { CASHFREE_PG_APP_ID: 'CHECKS_APP_ID', CASHFREE_PG_SECRET_KEY: SECRET, CASHFREE_ENV: 'sandbox', CASHFREE_API_VERSION: '2026-01-01', PUBLIC_BASE_URL: 'https://api.example.test' });
const useLocalDb = (on: boolean) => { for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) { if (on) process.env[k] = localEnv[k]; else delete process.env[k]; } };

let passed = 0;
const check = (what: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };
async function refused(what: string, status: number, run: () => Promise<unknown>, code?: string) {
  try { await run(); check(what, false, 'was accepted'); } catch (e) { const x = e as { status?: number; code?: string; message?: string }; check(what, x.status === status && (!code || x.code === code), `${x.status} ${x.code} ${x.message}`); }
}

// ---------------- the fake Cashfree ----------------
type FakeOrder = { order_id: string; cf_order_id: string; order_amount: number; order_status: string; payment_session_id: string; order_expiry_time: string };
type FakePayment = { cf_payment_id: string; order_id: string; payment_status: string; payment_amount: number; payment_group: string; payment_method: any; payment_time: string };
type FakeRefund = { refund_id: string; cf_refund_id: string; order_id: string; refund_amount: number; refund_status: string; status_description: string };
const orders = new Map<string, FakeOrder>(), payments: FakePayment[] = [], refunds = new Map<string, FakeRefund>();
const calls: { method: string; path: string; headers: Record<string, string>; body: any }[] = [];
let refundBehaviour: 'PENDING' | 'SUCCESS' | 'REJECT' | 'DOWN' = 'PENDING';
const err = (status: number, code: string, message: string) => Response.json({ code, type: 'invalid_request_error', message }, { status });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (/^(127\.0\.0\.1|localhost)$/.test(url.hostname)) return realFetch(input as any, init); // the LOCAL Supabase only
  if (url.host !== 'sandbox.cashfree.com') throw new Error(`unexpected fetch ${url}`);
  const path = url.pathname.replace(/^\/pg/, ''), method = init?.method ?? 'GET';
  const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path, headers, body });
  if (path !== '/orders/sessions' && (headers['x-client-id'] !== 'CHECKS_APP_ID' || headers['x-client-secret'] !== SECRET)) return err(401, 'request_failed', 'authentication Failed');
  if (!headers['x-api-version']) return err(400, 'x', 'version missing');
  let m: RegExpMatchArray | null;
  if (method === 'POST' && path === '/orders') {
    if (orders.has(body.order_id)) return err(409, 'order_already_exists', 'order with same id already exists');
    if (!/^[A-Za-z0-9_-]{3,45}$/.test(body.order_id) || body.order_amount < 1 || !body.customer_details?.customer_phone) return err(400, 'order_create_failed', 'bad order');
    const o: FakeOrder = { order_id: body.order_id, cf_order_id: `cf${orders.size + 1}`, order_amount: body.order_amount, order_status: 'ACTIVE', payment_session_id: `session_${randomBytes(12).toString('hex')}`, order_expiry_time: body.order_expiry_time };
    orders.set(o.order_id, o); return Response.json(o);
  }
  if (method === 'POST' && path === '/orders/sessions') {
    const o = [...orders.values()].find(x => x.payment_session_id === body.payment_session_id);
    if (!o) return err(404, 'orderpay_not_found', 'session not found');
    const ch = body.payment_method.upi.channel, id = String(7000 + payments.length);
    const base = { cf_payment_id: id, order_id: o.order_id, payment_status: 'PENDING', payment_amount: o.order_amount, payment_group: 'upi', payment_time: new Date().toISOString() };
    if (ch === 'collect') { if (!/@/.test(body.payment_method.upi.upi_id)) return err(400, 'upi_id_invalid', 'bad vpa'); payments.push({ ...base, payment_method: { upi: { channel: 'collect', upi_id: body.payment_method.upi.upi_id } } }); return Response.json({ action: 'custom', cf_payment_id: id, payment_method: 'upi', channel: 'collect', payment_amount: o.order_amount, data: { vpa: body.payment_method.upi.upi_id, expiry: new Date(Date.now() + 300_000).toISOString() } }); }
    payments.push({ ...base, payment_method: { upi: { channel: ch } } });
    if (ch === 'qrcode') return Response.json({ action: 'custom', cf_payment_id: id, payment_method: 'upi', channel: 'qrcode', payment_amount: o.order_amount, data: { payload: { qrcode: 'AAAA', default: 'upi://pay?pa=m@cf&am=1' } } });
    return Response.json({ action: 'custom', cf_payment_id: id, payment_method: 'upi', channel: 'link', payment_amount: o.order_amount, data: { payload: { default: 'upi://pay?pa=m@cf', gpay: 'tez://upi/pay?pa=m@cf', phonepe: 'phonepe://pay?pa=m@cf', paytm: 'paytmmp://pay?pa=m@cf', bhim: 'upi://pay?pa=m@cf&app=bhim' } } });
  }
  if ((m = path.match(/^\/orders\/([^/]+)\/payments$/)) && method === 'GET') return Response.json(payments.filter(p => p.order_id === m![1]).map(p => ({ ...p, payment_completion_time: p.payment_time, payment_message: 'msg' })));
  if ((m = path.match(/^\/orders\/([^/]+)\/refunds\/([^/]+)$/)) && method === 'GET') { const r = refunds.get(m[2]); return r ? Response.json(r) : err(404, 'refund_not_found', 'no refund'); }
  if ((m = path.match(/^\/orders\/([^/]+)\/refunds$/)) && method === 'POST') {
    const o = orders.get(m[1]); if (!o) return err(404, 'order_not_found', 'no order');
    if (refundBehaviour === 'DOWN') return err(500, 'internal', 'cashfree is down');
    if (refunds.has(body.refund_id)) return err(409, 'refund_already_exists', 'duplicate refund id');
    const taken = [...refunds.values()].filter(r => r.order_id === o.order_id && r.refund_status !== 'CANCELLED').reduce((n, r) => n + r.refund_amount, 0);
    if (taken + body.refund_amount > o.order_amount + 0.001) return err(400, 'refund_amount_invalid', 'refund amount exceeds the order');
    if (refundBehaviour === 'REJECT') return err(400, 'refund_not_allowed', 'bank rejected');
    const r: FakeRefund = { refund_id: body.refund_id, cf_refund_id: `rf${RUN}${refunds.size + 1}`, order_id: o.order_id, refund_amount: body.refund_amount, refund_status: refundBehaviour, status_description: 'ok' };
    refunds.set(r.refund_id, r); return Response.json(r);
  }
  if ((m = path.match(/^\/orders\/([^/]+)$/))) {
    const o = orders.get(m[1]); if (!o) return err(404, 'order_not_found', 'no order');
    if (method === 'PATCH') { o.order_status = 'TERMINATED'; return Response.json(o); }
    return Response.json(o);
  }
  throw new Error(`unexpected Cashfree call ${method} ${path}`);
}) as typeof fetch;

const hdr = (who: string, extra: Record<string, string> = {}) => ({ 'content-type': 'application/json', 'x-customer-key': who.padEnd(32, '0'), ...extra });
const req = (path: string, body: unknown, who: string, extra: Record<string, string> = {}) => new Request(`http://localhost/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: hdr(who, extra), body: body === undefined ? undefined : JSON.stringify(body) });
const address = { label: 'Home', text: 'Flat 4, Shivaji Chowk, Latur 413512', lat: 18.4088, lng: 76.5604, notes: '' };
const sign = (raw: string, ts = String(Date.now()), secret = SECRET) => ({ 'content-type': 'application/json', 'x-webhook-timestamp': ts, 'x-webhook-signature': createHmac('sha256', secret).update(ts + raw).digest('base64') });
const hook = (event: object, ts?: string, secret?: string) => { const raw = JSON.stringify(event); return new Request('http://localhost/api/payments/webhook', { method: 'POST', headers: sign(raw, ts, secret), body: raw }); };
const payEvent = (type: string, orderId: string, p: Partial<FakePayment> & { cf_payment_id: string }, amount: number) => ({
  data: { order: { order_id: orderId, order_amount: amount, order_currency: 'INR' }, payment: { payment_status: type === 'PAYMENT_SUCCESS_WEBHOOK' ? 'SUCCESS' : type === 'PAYMENT_FAILED_WEBHOOK' ? 'FAILED' : 'USER_DROPPED', payment_amount: amount, payment_group: 'upi', payment_method: { upi: { channel: 'link', upi_id: 'testsuccess@gocash' } }, ...p }, error_details: type === 'PAYMENT_FAILED_WEBHOOK' ? { error_description: 'declined by bank' } : undefined },
  event_time: new Date().toISOString(), type,
});

async function main() {
  useLocalDb(false);
  const pay = await import('../server/payments');
  const cfc = await import('../server/cashfree-checkout');
  const store = await import('../server/store');
  const pp = await import('../server/payment-provider');
  const { HttpError } = await import('../server/http');
  const body = { items: [{ id: 'f1', qty: 2 }], total: 270.9, address, payment_method: 'upi', upi_app: 'phonepe', prefill: { name: 'Asha Patil', email: 'asha@example.com', contact: '+91 98765 43210' } };

  // ---------- A. provider selection and methods ----------
  check('Cashfree is the active provider when its keys are set', pp.activeProvider()?.name === 'cashfree');
  const methods = await cfc.paymentMethods(req('payments/methods?total=200', undefined, 'm1'));
  check('methods: cashfree, sandbox, hosted card/netbanking/wallet, UPI apps, cod available with the cash note', methods.provider === 'cashfree' && methods.environment === 'sandbox' && methods.card.hosted && methods.netbanking.available && methods.wallet.available && methods.upi.apps.includes('phonepe') && methods.upi.collect && methods.cod.available && /exact change/.test(methods.cod.note), methods);
  process.env.COD_MAX_TOTAL = '150';
  const capped = await cfc.paymentMethods(req('payments/methods?total=200', undefined, 'm1'));
  check('methods: cod over the limit is unavailable with a reason and the limit', !capped.cod.available && capped.cod.reason === 'over_limit' && capped.cod.max_total === 150, capped.cod);
  await refused('cod checkout over the limit is refused by the server', 409, () => store.createCheckout(req('checkouts', { items: [{ id: 'f1', qty: 2 }], total: 270.9, address }, 'codcap'), 'latur'), 'cod_unavailable');
  delete process.env.COD_MAX_TOTAL;

  // ---------- A. create order ----------
  await refused('a mobile number is required for online payment', 400, () => pay.startPayment(req('payments/order', { ...body, prefill: {} }, 'c0', { 'idempotency-key': 'key-phone-0001' }), 'latur'), 'phone_required');
  await refused('an unknown method is refused', 400, () => pay.startPayment(req('payments/order', { ...body, payment_method: 'bitcoin' }, 'c0', { 'idempotency-key': 'key-bad-method1' }), 'latur'), 'choose_method');
  const start = await pay.startPayment(req('payments/order', body, 'c1', { 'idempotency-key': 'key-cashfree-01' }), 'latur');
  const created = calls.find(c => c.method === 'POST' && c.path === '/orders')!;
  check('create order: Cashfree order id = checkout id, amount = the SERVER total in rupees, INR, phone normalised', created.body.order_id === start.checkout_id && created.body.order_amount === 270.9 && created.body.order_currency === 'INR' && created.body.customer_details.customer_phone === '9876543210', created.body);
  check('create order: id/secret/version/idempotency (uuid) headers sent, secret never in the body', created.headers['x-client-id'] === 'CHECKS_APP_ID' && created.headers['x-api-version'] === '2026-01-01' && /^[0-9a-f-]{36}$/.test(created.headers['x-idempotency-key']) && !JSON.stringify(created.body).includes(SECRET));
  check('create order: return_url on our host, notify_url https webhook, 30 minute expiry', created.body.order_meta.return_url.startsWith('https://api.example.test/api/payments/return?checkout=') && created.body.order_meta.notify_url === 'https://api.example.test/api/payments/webhook' && Date.parse(created.body.order_expiry_time) - Date.now() > 25 * 60_000);
  check('reply: payment_session_id, hosted page and return addresses, amount in paise, pending, polling hints', start.provider === 'cashfree' && /^session_/.test(String(start.payment_session_id)) && start.amount === 27090 && start.payment_status === 'pending' && String(start.checkout_url).startsWith('https://api.example.test/api/payments/checkout-page?checkout=') && String(start.return_url).includes('/api/payments/return?') && start.poll.every_ms === 3000, { ...start, payment_session_id: '…' });
  const rec0 = await store.findPayment('id', start.checkout_id);
  check('stored: provider, Cashfree order ids and attempt count; the session id is NOT stored', rec0?.payment_provider === 'cashfree' && rec0.provider_order_id === start.checkout_id && rec0.cf_order_id === 'cf1' && rec0.payment_attempts === 1 && !JSON.stringify(rec0).includes('session_'), rec0);
  const again = await pay.startPayment(req('payments/order', body, 'c1', { 'idempotency-key': 'key-cashfree-01' }), 'latur');
  check('retry with the same key reuses the same checkout and the same live Cashfree order (no second order)', again.checkout_id === start.checkout_id && orders.size === 1 && again.payment_session_id === start.payment_session_id);
  await refused('the same key with a different basket is refused', 409, () => pay.startPayment(req('payments/order', { ...body, items: [{ id: 'f1', qty: 3 }], total: undefined }, 'c1', { 'idempotency-key': 'key-cashfree-01' }), 'latur'));

  // ---------- A. hosted page ----------
  const page = await cfc.checkoutPage(new Request(String(start.checkout_url), { headers: hdr('someone-else') }));
  const html = await page.text();
  check('hosted page: loads Cashfree JS v3, sandbox mode, the session id; no secret; opens only with the signed token', html.includes('https://sdk.cashfree.com/js/v3/cashfree.js') && html.includes('"mode":"sandbox"') && html.includes('payment_session_id'.slice(0, 0) + String(start.payment_session_id)) && !html.includes(SECRET));
  await refused('hosted page: a stranger without the token gets 404', 404, () => cfc.checkoutPage(req(`payments/checkout-page?checkout=${start.checkout_id}`, undefined, 'stranger')));
  await refused('hosted page: a forged token gets 404', 404, () => cfc.checkoutPage(req(`payments/checkout-page?checkout=${start.checkout_id}&t=zz.${'0'.repeat(32)}`, undefined, 'stranger')));

  // ---------- A. UPI intent / QR / collect ----------
  const intent = await cfc.startUpi(req('payments/upi', { checkout_id: start.checkout_id, mode: 'intent' }, 'c1', { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604' }));
  check('UPI intent: per-app links returned, pending, polling hints', intent.mode === 'intent' && intent.intent?.links.phonepe?.startsWith('phonepe://') && !!intent.intent.links.google_pay && !!intent.intent.links.paytm && !!intent.intent.links.bhim && intent.payment_status === 'pending', intent);
  const upiCall = calls.filter(c => c.path === '/orders/sessions').pop()!;
  check('order pay: no client secret sent (the session id is the credential), device hints sent', !upiCall.headers['x-client-secret'] && upiCall.headers['x-client-device'] === 'mobile' && upiCall.headers['x-client-os'] === 'ios' && upiCall.body.payment_method.upi.channel === 'link', upiCall.headers);
  await refused('a second UPI attempt while one is still being confirmed is refused (never pay twice)', 409, () => cfc.startUpi(req('payments/upi', { checkout_id: start.checkout_id, mode: 'qr' }, 'c1')), 'payment_in_progress');
  payments.length = 0;
  const qr = await cfc.startUpi(req('payments/upi', { checkout_id: start.checkout_id, mode: 'qr' }, 'c1'));
  check('UPI QR: image and upi link returned', qr.mode === 'qr' && qr.qr?.image === 'data:image/png;base64,AAAA' && String(qr.qr.upi_uri).startsWith('upi://'), qr);
  payments.length = 0;
  await refused('UPI collect: a malformed UPI ID is refused before Cashfree is called', 400, () => cfc.startUpi(req('payments/upi', { checkout_id: start.checkout_id, mode: 'collect', upi_id: 'not a vpa' }, 'c1')), 'upi_id_invalid');
  const collect = await cfc.startUpi(req('payments/upi', { checkout_id: start.checkout_id, mode: 'collect', upi_id: 'testsuccess@gocash' }, 'c1'));
  check('UPI collect: UPI id is masked in the reply, a countdown is given', collect.collect?.upi_id_masked === 'te***@gocash' && collect.collect.expires_in_s! > 0 && collect.collect.expires_in_s! <= 300 && !JSON.stringify(collect).includes('testsuccess@'), collect);
  await refused('UPI on someone else\'s checkout is 404', 404, () => cfc.startUpi(req('payments/upi', { checkout_id: start.checkout_id, mode: 'qr' }, 'thief')));

  // ---------- A. status: pending stays pending, success is read from Cashfree ----------
  let status = await cfc.checkoutStatus(req(`payments/status?checkout_id=${start.checkout_id}`, undefined, 'c1'));
  check('status: a payment still pending at the bank stays pending (keep polling, never pay again)', status.outcome === 'pending' && status.payment_status === 'pending' && status.poll_after_ms === 3000 && status.retry_ok === false, status);
  const rp = payments.find(p => p.order_id === start.checkout_id)!;
  rp.payment_status = 'SUCCESS'; orders.get(start.checkout_id)!.order_status = 'PAID'; rp.payment_group = 'upi';
  await new Promise(r => setTimeout(r, 2100));
  status = await cfc.checkoutStatus(req(`payments/status?checkout_id=${start.checkout_id}`, undefined, 'c1'));
  const rec1 = await store.findPayment('id', start.checkout_id);
  check('status: Cashfree says SUCCESS -> paid, with payment id, group and a MASKED payer reference', status.outcome === 'paid' && rec1?.payment_status === 'paid' && rec1.cf_payment_id === rp.cf_payment_id && rec1.payment_group === 'upi' && rec1.payment_reference_masked === 'te***@gocash', { status, rec1 });
  check('status: every store order of the checkout shows paid', (await store.findPayment('id', rec1!.order_ids[0]))?.payment_status === 'paid');

  // ---------- A. webhooks ----------
  const ok = payEvent('PAYMENT_SUCCESS_WEBHOOK', start.checkout_id, { cf_payment_id: rp.cf_payment_id }, 270.9);
  const w1 = await cfc.handleCashfreeWebhook(hook(ok));
  check('webhook: a good signature is accepted (200 body ok)', (w1 as any).ok === true);
  await refused('webhook: a wrong signature is refused (400)', 400, () => cfc.handleCashfreeWebhook(hook(ok, undefined, 'a-different-secret')), 'bad_signature');
  const raw = JSON.stringify(ok);
  await refused('webhook: a body changed after signing is refused', 400, () => cfc.handleCashfreeWebhook(new Request('http://localhost/api/payments/webhook', { method: 'POST', headers: sign(raw), body: raw.replace('270.9', '1') })), 'bad_signature');
  await refused('webhook: no signature header is refused', 400, () => cfc.handleCashfreeWebhook(new Request('http://localhost/api/payments/webhook', { method: 'POST', headers: { 'x-webhook-timestamp': String(Date.now()) }, body: raw })), 'bad_signature');
  await refused('webhook: a correctly signed but stale (10 min old) timestamp is refused (replay window)', 400, () => cfc.handleCashfreeWebhook(hook(ok, String(Date.now() - 10 * 60_000))), 'stale_timestamp');
  const dup = await cfc.handleCashfreeWebhook(hook(ok));
  check('webhook: the same event again is a no-op answered 200 (duplicate)', (dup as any).ok === true && (dup as any).duplicate === true);
  const fx = await cfc.handleCashfreeWebhook(hook({ ...ok, event_time: 'later' })).catch(e => e);
  check('webhook: an unsigned-body variant is a different event but cannot change a paid checkout', (await store.findPayment('id', start.checkout_id))?.payment_status === 'paid' && (fx as any).ok === true);
  const failedAfterPaid = payEvent('PAYMENT_FAILED_WEBHOOK', start.checkout_id, { cf_payment_id: '9999' }, 270.9);
  await cfc.handleCashfreeWebhook(hook(failedAfterPaid));
  check('forward-only: a FAILED event after PAID never moves the checkout back', (await store.findPayment('id', start.checkout_id))?.payment_status === 'paid');

  // failed / dropped / amount mismatch / unknown order
  const mk = async (who: string, key: string) => { const s = await pay.startPayment(req('payments/order', body, who, { 'idempotency-key': key }), 'latur'); return s; };
  const s2 = await mk('c2', 'key-cashfree-02');
  await cfc.handleCashfreeWebhook(hook(payEvent('PAYMENT_FAILED_WEBHOOK', s2.checkout_id, { cf_payment_id: '8001' }, 270.9)));
  let st = await cfc.checkoutStatus(req(`payments/status?checkout_id=${s2.checkout_id}`, undefined, 'c2'));
  check('failed webhook: outcome failed with a plain-words reason, retry allowed, the order is not lost', st.outcome === 'failed' && st.retry_ok === true && /No money was taken/.test(String(st.message)) && !/declined by bank/.test(String(st.message)), st);
  const retry = await pay.startPayment(req('payments/order', body, 'c2', { 'idempotency-key': 'key-cashfree-02' }), 'latur');
  check('retry after a failure on the same still-active order reuses it (same checkout)', retry.checkout_id === s2.checkout_id && orders.size === 2);
  const s3 = await mk('c3', 'key-cashfree-03');
  await cfc.handleCashfreeWebhook(hook(payEvent('PAYMENT_USER_DROPPED_WEBHOOK', s3.checkout_id, { cf_payment_id: '8002' }, 270.9)));
  st = await cfc.checkoutStatus(req(`payments/status?checkout_id=${s3.checkout_id}`, undefined, 'c3'));
  check('user dropped: outcome dropped, "you closed the payment" wording', st.outcome === 'dropped' && /closed the payment/.test(String(st.message)), st);
  await cfc.handleCashfreeWebhook(hook(payEvent('PAYMENT_SUCCESS_WEBHOOK', s3.checkout_id, { cf_payment_id: '8003' }, 270.9)));
  check('a late success after a drop still pays the checkout (failed -> paid is allowed)', (await store.findPayment('id', s3.checkout_id))?.payment_status === 'paid');
  const s4 = await mk('c4', 'key-cashfree-04');
  await cfc.handleCashfreeWebhook(hook(payEvent('PAYMENT_SUCCESS_WEBHOOK', s4.checkout_id, { cf_payment_id: '8004' }, 100)));
  const r4 = await store.findPayment('id', s4.checkout_id);
  check('amount mismatch: a payment for a different amount never pays the checkout', r4?.payment_status !== 'paid' && r4?.payment_status === 'failed' && /did not match/.test(String(r4.payment_error)), r4);
  const unknown = await cfc.handleCashfreeWebhook(hook(payEvent('PAYMENT_SUCCESS_WEBHOOK', crypto.randomUUID(), { cf_payment_id: '8005' }, 50)));
  check('webhook for an order we do not know: answered 200 (so Cashfree stops), nothing changes', (unknown as any).ok === true);

  // pending then reconcile from the sweep path: failed order from Cashfree's side
  const s5 = await mk('c5', 'key-cashfree-05');
  orders.get(s5.checkout_id)!.order_status = 'EXPIRED';
  let rec5 = await store.findPayment('id', s5.checkout_id);
  rec5 = await cfc.reconcileCashfreeCheckout(rec5!, 'sweep');
  check('reconcile: an expired Cashfree order with no payment ends as expired (retry allowed)', rec5.payment_status === 'failed' && rec5.payment_failure_code === 'expired', rec5);
  const reopened = await pay.startPayment(req('payments/order', body, 'c5', { 'idempotency-key': 'key-cashfree-05' }), 'latur');
  check('a new Cashfree order (new id, never reused) opens after the first expired', reopened.checkout_id === s5.checkout_id && [...orders.keys()].includes(`${s5.checkout_id}-2`) && (await store.findPayment('id', s5.checkout_id))?.payment_attempts === 2);

  // switch to cash: the Cashfree order is closed; a payment that still lands is not turned into a paid order
  const s6 = await mk('c6', 'key-cashfree-06');
  await pay.switchToCash(req('payments/cod', { checkout_id: s6.checkout_id }, 'c6'));
  check('switch to cash: checkout is cod/not_charged and the unpaid Cashfree order is terminated', (await store.findPayment('id', s6.checkout_id))?.payment_method === 'cod' && orders.get(s6.checkout_id)!.order_status === 'TERMINATED');
  await cfc.handleCashfreeWebhook(hook(payEvent('PAYMENT_SUCCESS_WEBHOOK', s6.checkout_id, { cf_payment_id: '8006' }, 270.9)));
  check('a payment landing after the switch to cash does not make a paid order', (await store.findPayment('id', s6.checkout_id))?.payment_status === 'not_charged');

  // verify route (older paths) re-reads
  const vr = await pay.verifyPayment(req('payments/verify', { checkout_id: start.checkout_id }, 'c1'));
  check('verify on a Cashfree checkout answers from Cashfree\'s record', vr.payment_status === 'paid');
  const sec = JSON.stringify(calls.map(c => c.body ?? ''));
  check('no secret appears in any request body sent to Cashfree', !sec.includes(SECRET));

  // ---------- B. refunds on the LOCAL database ----------
  useLocalDb(true);
  const { db } = await import('../server/db');
  const refunds_ = await import('../server/refunds');
  const d = db();
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
  // park other people's queued refunds so the worker (which claims ANY queued refund) touches only ours
  const parked = must(await d.from('ol_refunds').select('id').in('status', ['requested', 'gateway_pending', 'failed']).eq('method', 'original'));
  if (parked.length) must(await d.from('ol_refunds').update({ method: 'manual' }).in('id', parked.map((r: any) => r.id)));
  const madeCheckouts: string[] = [];
  const mkPaid = async (total: number, split: number[] = [total], provider: 'cashfree' | 'razorpay' = 'cashfree', method = 'upi') => {
    const cid = crypto.randomUUID(), cust = `zz${randomBytes(8).toString('hex')}`;
    must(await d.from('ol_checkouts').insert({ id: cid, customer_hash: cust, kind: 'food', item_total: total, total, payment_method: method, payment_status: 'pending', city_id: 'latur', ...(provider === 'cashfree' ? { payment_provider: 'cashfree', provider_order_id: cid, cf_order_id: 'cfx' } : { razorpay_order_id: `order_zz${cid.slice(0, 6)}`, payment_provider: 'razorpay' }) }));
    const ids: string[] = [];
    for (const t of split) { const id = crypto.randomUUID(); ids.push(id); must(await d.from('ol_orders').insert({ id, customer_hash: cust, items: [], subtotal: t, total: t, payment_method: method, payment_status: 'pending', status: method === 'cod' ? 'cancelled' : 'delivered', city_id: 'latur', checkout_id: cid })); }
    must(await d.from('ol_checkouts').update({ payment_status: method === 'cod' ? 'not_charged' : 'paid', ...(provider === 'cashfree' ? { cf_payment_id: `pay${randomBytes(4).toString('hex')}` } : {}), paid_at: new Date().toISOString() }).eq('id', cid));
    madeCheckouts.push(cid);
    if (provider === 'cashfree') orders.set(cid, { order_id: cid, cf_order_id: 'cfx', order_amount: total, order_status: 'PAID', payment_session_id: 's', order_expiry_time: '' });
    return { cid, ids, cust };
  };
  const refundRows = async (orderId: string) => must(await d.from('ol_refunds').select('id, amount, status, provider, provider_status, provider_refund_id, reference, refund_speed, last_error').eq('order_id', orderId).order('created_at'));
  try {
    const sendsToCashfree = () => calls.filter(c => c.method === 'POST' && /\/refunds$/.test(c.path));
    // full refund, accepted as PENDING -> in flight, then the REFUND_STATUS webhook makes it processed
    refundBehaviour = 'PENDING'; calls.length = 0;
    const a = await mkPaid(200);
    const out1 = await refunds_.refundOrderShare({ id: a.ids[0], total: 200, checkout_id: a.cid }, 'x', 'Order could not be fulfilled', true, { provider: 'cashfree', providerOrderId: a.cid, paidMinor: 20000 });
    const row1 = (await refundRows(a.ids[0]))[0];
    const sent = sendsToCashfree()[0];
    if (!row1) { console.log('DEBUG', out1, JSON.stringify(row1), calls.length, JSON.stringify(calls.map(c => c.path)), a.ids[0], JSON.stringify(must(await d.from('ol_refunds').select('order_id,status').eq('order_id', a.ids[0])))); }
    check('full refund: sent to the checkout\'s Cashfree order, STANDARD speed, 200.00, deterministic id (olr_..., 3-40 chars)', out1 === 'in_flight' && sent.path === `/orders/${a.cid}/refunds` && sent.body.refund_amount === 200 && sent.body.refund_speed === 'STANDARD' && /^olr_[0-9a-f]{24}$/.test(sent.body.refund_id) && sent.body.refund_note.length >= 3, { out1, sent });
    check('full refund: booked gateway_pending with provider, ids and speed; NOT processed until Cashfree says so; order not yet "refunded"', row1.status === 'gateway_pending' && row1.provider === 'cashfree' && row1.provider_status === 'PENDING' && row1.reference === sent.body.refund_id && row1.refund_speed === 'STANDARD' && must(await d.from('ol_orders').select('payment_status').eq('id', a.ids[0]))[0].payment_status !== 'refunded', row1);
    const out2 = await refunds_.refundOrderShare({ id: a.ids[0], total: 200, checkout_id: a.cid }, 'x', 'again', true, { provider: 'cashfree', providerOrderId: a.cid, paidMinor: 20000 });
    check('double refund prevented: a second request for the same order sends nothing to Cashfree', out2 === 'nothing_to_refund' && sendsToCashfree().length === 1 && (await refundRows(a.ids[0])).length === 1, out2);
    const whRefund = (status: string, rf: any, extra: object = {}) => ({ data: { refund: { cf_refund_id: `w${RUN}1`, cf_payment_id: 9, refund_id: rf.reference, order_id: a.cid, refund_amount: rf.amount, refund_currency: 'INR', refund_status: status, status_description: status === 'SUCCESS' ? 'Refund processed successfully' : 'x', ...extra } }, event_time: new Date().toISOString(), type: 'REFUND_STATUS_WEBHOOK' });
    const okRefund = whRefund('SUCCESS', row1);
    await cfc.handleCashfreeWebhook(hook(okRefund));
    const done1 = (await refundRows(a.ids[0]))[0];
    check('REFUND_STATUS_WEBHOOK SUCCESS: refund processed, order and checkout refunded, history written', done1.status === 'processed' && must(await d.from('ol_orders').select('payment_status').eq('id', a.ids[0]))[0].payment_status === 'refunded' && must(await d.from('ol_refund_events').select('status').eq('refund_id', row1.id)).length >= 1, done1);
    const again2 = await cfc.handleCashfreeWebhook(hook(okRefund));
    check('the refund webhook again is a duplicate no-op', (again2 as any).duplicate === true && (await refundRows(a.ids[0])).length === 1);

    // partial refunds with a cumulative cap: checkout of 2 store orders (120 + 80)
    calls.length = 0;
    const b = await mkPaid(200, [120, 80]);
    const part = await refunds_.refundOrderShare({ id: b.ids[0], total: 120, checkout_id: b.cid }, 'x', 'Item missing', true, { provider: 'cashfree', providerOrderId: b.cid, paidMinor: 20000 });
    check('partial refund: the order share goes to the checkout\'s Cashfree order', part === 'in_flight' && sendsToCashfree()[0].body.refund_amount === 120);
    const over = await refunds_.refundOrderShare({ id: b.ids[1], total: 80, checkout_id: b.cid }, 'x', 'Item missing', true, { provider: 'cashfree', providerOrderId: b.cid, paidMinor: 10000 });
    check('over-refund refused: a share that would take the checkout past what was paid sends nothing', over === 'due' && sendsToCashfree().length === 1 && (await refundRows(b.ids[1])).length === 0, over);
    const rest = await refunds_.refundOrderShare({ id: b.ids[1], total: 80, checkout_id: b.cid }, 'x', 'Item missing', true, { provider: 'cashfree', providerOrderId: b.cid, paidMinor: 20000 });
    check('the remaining share (up to the paid total) is accepted', rest === 'in_flight' && sendsToCashfree().length === 2);
    const tooMuch = await refundDirect(d, b.cid, b.ids[0]);
    function refundDirect(...x: any[]) { return Promise.resolve(x.length > 0); }
    check('cumulative: 120 + 80 = the 200 paid, nothing more can be issued', tooMuch && (await refundRows(b.ids[0])).length + (await refundRows(b.ids[1])).length === 2);

    // Cashfree itself caps (stub): a refund over the order amount is rejected by the gateway too
    // lost reply: the same refund id again returns the same Cashfree refund
    calls.length = 0;
    const c = await mkPaid(90);
    refundBehaviour = 'PENDING';
    const first = await refunds_.refundOrderShare({ id: c.ids[0], total: 90, checkout_id: c.cid }, 'x', 'Lost reply', true, { provider: 'cashfree', providerOrderId: c.cid, paidMinor: 9000 });
    must(await d.from('ol_refunds').delete().eq('order_id', c.ids[0])); // simulate: the booking was lost after Cashfree accepted it
    const second = await refunds_.refundOrderShare({ id: c.ids[0], total: 90, checkout_id: c.cid }, 'x', 'Lost reply', true, { provider: 'cashfree', providerOrderId: c.cid, paidMinor: 9000 });
    const ids = sendsToCashfree().map(x => x.body.refund_id);
    check('retry after a lost reply uses the SAME refund id, so Cashfree holds one refund only', first === 'in_flight' && second === 'in_flight' && ids.length === 2 && ids[0] === ids[1] && [...refunds.values()].filter(r => r.order_id === c.cid).length === 1, ids);

    // gateway down: stays due; rejection: goes to the queue and is visible
    refundBehaviour = 'DOWN';
    const e = await mkPaid(60);
    const down = await refunds_.refundOrderShare({ id: e.ids[0], total: 60, checkout_id: e.cid }, 'x', 'Cashfree down', true, { provider: 'cashfree', providerOrderId: e.cid, paidMinor: 6000 });
    check('Cashfree down: the refund stays due (no row claims it is done) for the sweep to retry', down === 'due' && (await refundRows(e.ids[0])).length === 0);
    refundBehaviour = 'REJECT';
    const rej = await refunds_.refundOrderShare({ id: e.ids[0], total: 60, checkout_id: e.cid }, 'x', 'Bank says no', true, { provider: 'cashfree', providerOrderId: e.cid, paidMinor: 6000 });
    const queued = await refundRows(e.ids[0]);
    check('Cashfree refuses: the refund waits in the retry queue, visible with its reason', rej === 'in_flight' && queued.length === 1 && queued[0].status === 'requested' && /refused/.test(String(queued[0].last_error)) && queued[0].provider === 'cashfree', queued);

    // the worker: queued refund -> Cashfree PENDING -> gateway_pending (not requeued) -> poll SUCCESS
    refundBehaviour = 'PENDING'; calls.length = 0;
    const f = await mkPaid(150);
    const qid = must(await d.from('ol_refunds').insert({ order_id: f.ids[0], amount: 150, reason: 'Order could not be fulfilled', method: 'original', status: 'requested', idempotency_key: `compensate:${f.ids[0]}` }).select('id'))[0].id as string;
    const w1_ = await refunds_.completeQueuedRefunds();
    const qrow = (await refundRows(f.ids[0]))[0];
    const call = sendsToCashfree().find(x => x.path.includes(f.cid))!;
    check('worker: a queued refund of a Cashfree payment goes to Cashfree with the same deterministic id and STANDARD speed', w1_.claimed >= 1 && !!call && call.body.refund_amount === 150 && call.body.refund_speed === 'STANDARD' && qrow.status === 'gateway_pending' && qrow.provider === 'cashfree', { w1_, qrow });
    must(await d.from('ol_refunds').update({ created_at: new Date(Date.now() - 5 * 60_000).toISOString() }).eq('id', qid));
    refunds.get(call.body.refund_id)!.refund_status = 'SUCCESS';
    const polled = await refunds_.pollGatewayRefunds();
    check('poll: Cashfree now says SUCCESS -> processed (webhook not needed)', polled.processed >= 1 && (await refundRows(f.ids[0]))[0].status === 'processed', polled);

    // worker with Cashfree cancelling: failed, new id on the next try
    calls.length = 0;
    const g_ = await mkPaid(70);
    const q2 = must(await d.from('ol_refunds').insert({ order_id: g_.ids[0], amount: 70, reason: 'Order could not be fulfilled', method: 'original', status: 'requested', idempotency_key: `compensate:${g_.ids[0]}` }).select('id'))[0].id as string;
    await refunds_.completeQueuedRefunds();
    const gr = (await refundRows(g_.ids[0]))[0];
    await cfc.handleCashfreeWebhook(hook({ data: { refund: { cf_refund_id: `w${RUN}2`, refund_id: gr.reference, order_id: g_.cid, refund_amount: 70, refund_status: 'CANCELLED', status_description: 'bank could not credit' } }, event_time: new Date().toISOString(), type: 'REFUND_STATUS_WEBHOOK' }));
    const failedRow = (await refundRows(g_.ids[0]))[0];
    check('REFUND_STATUS CANCELLED: refund is failed, kept in the retry queue (visible to operations)', failedRow.status === 'failed' && /CANCELLED/.test(String(failedRow.last_error)), failedRow);
    must(await d.from('ol_refunds').update({ claimed_at: new Date(Date.now() - 86_400_000).toISOString() }).eq('id', q2));
    await refunds_.completeQueuedRefunds();
    const ids2 = sendsToCashfree().filter(x => x.path.includes(g_.cid)).map(x => x.body.refund_id);
    check('retry after Cashfree cancelled the refund uses a NEW refund id', ids2.length === 2 && ids2[0] !== ids2[1], ids2);

    // cash orders never reach the gateway
    calls.length = 0;
    const cash = await mkPaid(80, [80], 'cashfree', 'cod');
    await refunds_.refundDue(); await refunds_.completeQueuedRefunds();
    check('cash on delivery: nothing is ever sent to the gateway for a cash order', sendsToCashfree().filter(x => x.path.includes(cash.cid)).length === 0 && (await refundRows(cash.ids[0])).length === 0);

    // a refund made in the Cashfree dashboard (nobody here asked for it) is ledgered
    const h = await mkPaid(40);
    await cfc.handleCashfreeWebhook(hook({ data: { refund: { cf_refund_id: `w${RUN}3`, refund_id: 'dash_refund_1', order_id: h.cid, refund_amount: 40, refund_status: 'SUCCESS' } }, event_time: new Date().toISOString(), type: 'REFUND_STATUS_WEBHOOK' }));
    check('a refund made in the Cashfree dashboard is booked as processed (once)', (await refundRows(h.ids[0])).length === 1 && (await refundRows(h.ids[0]))[0].status === 'processed');

    // webhook log is idempotent in the database too
    const ev = payEvent('PAYMENT_SUCCESS_WEBHOOK', a.cid, { cf_payment_id: 'dbpay1' }, 200);
    await cfc.handleCashfreeWebhook(hook(ev)); await cfc.handleCashfreeWebhook(hook(ev));
    const logged = must(await d.from('payment_webhook_events').select('outcome').eq('provider', 'cashfree').eq('checkout_id', a.cid));
    check('webhook log: one row per event even when delivered twice; outcome recorded', logged.length === 1 && logged[0].outcome !== 'received', logged);
  } finally {
    // clean up: everything this run made (test rows are tagged by the zz customer hash); then give parked refunds back
    for (const cid of madeCheckouts) {
      const ords = must(await d.from('ol_orders').select('id').eq('checkout_id', cid)).map((o: any) => o.id);
      if (ords.length) { await d.from('ol_refunds').update({ method: 'manual' }).in('order_id', ords); }
    }
    if (parked.length) await d.from('ol_refunds').update({ method: 'original' }).in('id', parked.map((r: any) => r.id));
    await d.from('payment_webhook_events').update({ outcome: 'ignored' }).in('checkout_id', madeCheckouts);
  }
  console.log(`\n${passed} checks passed${process.exitCode ? ' - WITH FAILURES' : ''}.`);
}
main().catch(e => { console.error(e); process.exit(1); });
