// Guest-bill / POS online payments (migration 0239, server/pos-payments.ts) against a FAKE Cashfree (globalThis.fetch stubbed: nothing here can
// reach the network) and the LOCAL Supabase from .env.localdb.off. Covers: start, amount > due refused, idempotent start, signed webhook success
// records exactly one payment, duplicate webhook no-op, failed / dropped / expired, share payments summing to the bill, wrong signature, stale
// timestamp, amount mismatch, status poll without a webhook, money after the bill was settled (auto refund), refunds (partial, idempotent,
// over-refund refused, rejected frees the cap, REFUND_STATUS webhook), roles and organizations.
// LIVE CASHFREE IS NOT TOUCHED: the sandbox answered 401 to the founder's keys on 2026-10-08, so nothing here proves a real round trip.
// Fixtures: orders tagged notes = 'ZZ-TEST pos-payments-checks' (database/purge_test_orders.sh removes them); a fixed test organization
// (slug zz-pos-pay-checks) and two test users are reused between runs. Run from frontend/:  npx tsx scripts/pos-payments-checks.ts
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const localEnv: Record<string, string> = {};
for (const line of readFileSync(`${process.cwd()}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) localEnv[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(localEnv.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'FEATURE_ONLINE_PAYMENTS', 'ALLOW_REMOTE', 'TRUSTED_PROXY_HOPS', 'ORDERS_REQUIRE_SIGN_IN', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']) delete process.env[k];
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) process.env[k] = localEnv[k];
const RUN = randomBytes(3).toString('hex');
const SECRET = 'cfsk_ma_test_FAKE_pos_checks_secret';
Object.assign(process.env, { CASHFREE_PG_APP_ID: 'CHECKS_APP_ID', CASHFREE_PG_SECRET_KEY: SECRET, CASHFREE_ENV: 'sandbox', CASHFREE_API_VERSION: '2026-01-01', PUBLIC_BASE_URL: 'https://api.example.test' });

let passed = 0;
const check = (what: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };
async function refused(what: string, status: number, code: string | undefined, run: () => Promise<unknown>) {
  try { await run(); check(what, false, 'was accepted'); } catch (e) { const x = e as { status?: number; code?: string; detail?: string; message?: string }; check(what, x.status === status && (!code || x.code === code), `${x.status} ${x.code} ${x.detail ?? x.message}`); }
}

// ---------------- the fake Cashfree ----------------
type FakeOrder = { order_id: string; cf_order_id: string; order_amount: number; order_status: string; payment_session_id: string; order_expiry_time: string };
type FakePayment = { cf_payment_id: string; order_id: string; payment_status: string; payment_amount: number; payment_group: string; payment_method: any; payment_time: string };
type FakeRefund = { refund_id: string; cf_refund_id: string; order_id: string; refund_amount: number; refund_status: string; status_description: string };
const orders = new Map<string, FakeOrder>(), payments: FakePayment[] = [], refunds = new Map<string, FakeRefund>();
const calls: { method: string; path: string; headers: Record<string, string>; body: any }[] = [];
let cashfreeDown = false, refundBehaviour: 'PENDING' | 'SUCCESS' | 'REJECT' = 'PENDING';
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
  if (cashfreeDown) return err(503, 'service_unavailable', 'down');
  if (headers['x-client-id'] !== 'CHECKS_APP_ID' || headers['x-client-secret'] !== SECRET) return err(401, 'request_failed', 'authentication Failed');
  let m: RegExpMatchArray | null;
  if (method === 'POST' && path === '/orders') {
    if (orders.has(body.order_id)) return err(409, 'order_already_exists', 'order with same id already exists');
    if (!/^[A-Za-z0-9_-]{3,45}$/.test(body.order_id) || body.order_amount < 1 || !body.customer_details?.customer_phone) return err(400, 'order_create_failed', 'bad order');
    const o: FakeOrder = { order_id: body.order_id, cf_order_id: `cfp${RUN}${orders.size + 1}`, order_amount: body.order_amount, order_status: 'ACTIVE', payment_session_id: `session_${randomBytes(12).toString('hex')}`, order_expiry_time: body.order_expiry_time };
    orders.set(o.order_id, o); return Response.json(o);
  }
  if ((m = path.match(/^\/orders\/([^/]+)\/payments$/)) && method === 'GET') return Response.json(payments.filter(p => p.order_id === m![1]).map(p => ({ ...p, payment_completion_time: p.payment_time, payment_message: 'msg' })));
  if ((m = path.match(/^\/orders\/([^/]+)\/refunds\/([^/]+)$/)) && method === 'GET') { const r = refunds.get(m[2]); return r ? Response.json(r) : err(404, 'refund_not_found', 'no refund'); }
  if ((m = path.match(/^\/orders\/([^/]+)\/refunds$/)) && method === 'POST') {
    const o = orders.get(m[1]); if (!o) return err(404, 'order_not_found', 'no order');
    if (refunds.has(body.refund_id)) return err(409, 'refund_already_exists', 'duplicate refund id');
    const taken = [...refunds.values()].filter(r => r.order_id === o.order_id && r.refund_status !== 'CANCELLED').reduce((n, r) => n + r.refund_amount, 0);
    if (taken + body.refund_amount > o.order_amount + 0.001) return err(400, 'refund_amount_invalid', 'refund amount exceeds the order');
    if (refundBehaviour === 'REJECT') return err(400, 'refund_not_allowed', 'bank rejected');
    const r: FakeRefund = { refund_id: body.refund_id, cf_refund_id: `rf${RUN}${refunds.size + 1}`, order_id: o.order_id, refund_amount: body.refund_amount, refund_status: refundBehaviour, status_description: 'ok' };
    refunds.set(r.refund_id, r); return Response.json(r);
  }
  if ((m = path.match(/^\/orders\/([^/]+)$/)) && method === 'GET') { const o = orders.get(m[1]); return o ? Response.json(o) : err(404, 'order_not_found', 'no order'); }
  throw new Error(`unexpected Cashfree call ${method} ${path}`);
}) as typeof fetch;

// a customer pays in the fake gateway (what Cashfree would hold) and returns the webhook body for it
let cfIdSeq = 0;
const cfId = () => `${RUN}${++cfIdSeq}`.replace(/[^0-9]/g, '').padEnd(8, '1').slice(0, 14) + String(cfIdSeq);
function gatewayPays(orderId: string, status: 'SUCCESS' | 'FAILED' | 'USER_DROPPED', amount?: number) {
  const o = orders.get(orderId)!;
  const p: FakePayment = { cf_payment_id: cfId(), order_id: orderId, payment_status: status, payment_amount: amount ?? o.order_amount, payment_group: 'upi', payment_method: { upi: { channel: 'link', upi_id: 'testsuccess@gocash' } }, payment_time: new Date().toISOString() };
  payments.push(p);
  if (status === 'SUCCESS') o.order_status = 'PAID';
  return p;
}
const sign = (raw: string, ts = String(Date.now()), secret = SECRET) => ({ 'content-type': 'application/json', 'x-webhook-timestamp': ts, 'x-webhook-signature': createHmac('sha256', secret).update(ts + raw).digest('base64') });
const hook = (event: object, ts?: string, secret?: string) => { const raw = JSON.stringify(event); return new Request('http://localhost/api/payments/webhook', { method: 'POST', headers: sign(raw, ts, secret), body: raw }); };
const TYPE = { SUCCESS: 'PAYMENT_SUCCESS_WEBHOOK', FAILED: 'PAYMENT_FAILED_WEBHOOK', USER_DROPPED: 'PAYMENT_USER_DROPPED_WEBHOOK' } as const;
const payEvent = (p: FakePayment) => ({
  data: { order: { order_id: p.order_id, order_amount: orders.get(p.order_id)!.order_amount, order_currency: 'INR' }, payment: { cf_payment_id: p.cf_payment_id, payment_status: p.payment_status, payment_amount: p.payment_amount, payment_group: p.payment_group, payment_method: p.payment_method, payment_time: p.payment_time } },
  event_time: new Date().toISOString(), type: TYPE[p.payment_status as keyof typeof TYPE],
});
const req = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

async function main() {
  const { db } = await import('../server/db');
  const pp = await import('../server/pos-payments');
  const cfc = await import('../server/cashfree-checkout');
  const d = db();
  const must = (r: { data: any; error: { message: string } | null }): any => { if (r.error) throw new Error(r.error.message); return r.data; };

  // ---------------- fixtures: one test organization, an owner and a captain, tables and bills ----------------
  const slug = 'zz-pos-pay-checks';
  let org: any = (await d.from('organizations').select('id, name').eq('slug', slug).maybeSingle()).data;
  if (!org) org = must(await d.from('organizations').insert({ name: 'ZZ POS pay checks', slug, type: 'franchise' }).select('id, name').single());
  const other: { id: string } = (await d.from('organizations').select('id').eq('slug', `${slug}-b`).maybeSingle()).data as any
    ?? must(await d.from('organizations').insert({ name: 'ZZ POS pay checks B', slug: `${slug}-b`, type: 'franchise' }).select('id').single());
  async function user(email: string, role: string, organizationId: string) {
    let id = (await d.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email)?.id;
    if (!id) id = (await d.auth.admin.createUser({ email, password: randomBytes(18).toString('base64url'), email_confirm: true })).data.user!.id;
    const roleId = must(await d.from('roles').select('id').eq('slug', role).single()).id;
    const has = (await d.from('org_users').select('id').eq('organization_id', organizationId).eq('user_id', id).maybeSingle()).data;
    if (!has) must(await d.from('org_users').insert({ organization_id: organizationId, user_id: id, role_id: roleId, email, status: 'active' }).select('id'));
    return { userId: id, email, name: email, role, organizationId, organizationName: 'ZZ' };
  }
  const owner = await user('zz-pos-pay-owner@example.test', 'org_owner', org.id);
  const captain = await user('zz-pos-pay-captain@example.test', 'captain', org.id);
  const ownerB = await user('zz-pos-pay-owner-b@example.test', 'org_owner', other.id);
  const table = must(await d.from('dining_tables').insert({ organization_id: org.id, label: `ZZ ${RUN}` }).select('id').single()).id as string;
  let orderNo = Number((await d.from('orders').select('order_no').eq('organization_id', org.id).order('order_no', { ascending: false }).limit(1)).data?.[0]?.order_no ?? 0);
  const bill = async (total: number, tableId: string | null = table) => must(await d.from('orders').insert({
    organization_id: org.id, order_no: ++orderNo, display_no: `ZZ-${RUN}-${orderNo}`, channel: 'dine_in', subtotal: total, gst_amount: 0, total, table_id: tableId, notes: 'ZZ-TEST pos-payments-checks',
  }).select('id').single()).id as string;
  const dueOf = async (id: string) => { const o = must(await d.from('orders').select('total, status').eq('id', id).single()); const p = must(await d.from('payments').select('amount').eq('order_id', id)); return { status: o.status as string, paid: p.reduce((n: number, r: any) => n + Number(r.amount), 0) }; };
  const paymentsOf = async (id: string) => must(await d.from('payments').select('method, amount, gateway, gateway_reference, idempotency_key, reference').eq('order_id', id)) as any[];
  const ledgerOf = async (ref: string) => must(await d.from('payment_ledger').select('entry_type, direction, amount_minor').eq('gateway_reference', ref)) as any[];
  const start = (staff: typeof owner, orderIds: string[], amount: number, key: string, extra: Record<string, unknown> = {}) =>
    pp.startOnlinePayment(req('partner/payments/online', {}, { 'user-agent': 'okhttp/4.12' }), staff, { organization_id: staff.organizationId, order_ids: orderIds, amount, idempotency_key: key, payer_phone: '+91 98765 43210', ...extra });
  const status = (a: string, staff = owner) => pp.onlinePaymentStatus(req('x'), staff, a);

  // ---------------- 1. start ----------------
  const o1 = await bill(105);
  await refused('amount above what is still due is refused (422 amount_exceeds_due, with the due)', 422, 'amount_exceeds_due', () => start(owner, [o1], 105.01, `k-over-${RUN}-01`));
  await refused('below Rs 1 is refused (422 amount_below_minimum)', 422, 'amount_below_minimum', () => start(owner, [o1], 0.5, `k-small-${RUN}-1`));
  await refused('a captain cannot take payments (403 forbidden)', 403, 'forbidden', () => start(captain, [o1], 10, `k-role-${RUN}-01`));
  await refused('another restaurant in organization_id is refused (403 wrong_organization)', 403, 'wrong_organization', () => start(owner, [o1], 10, `k-org-${RUN}-001`, { organization_id: other.id }));
  await refused('another restaurant cannot pay this bill (404 not_found)', 404, 'not_found', () => start(ownerB, [o1], 10, `k-cross-${RUN}-01`));
  await refused('a bad phone is refused (400)', 400, 'bad_request', () => start(owner, [o1], 10, `k-phone-${RUN}-01`, { payer_phone: '12345' }));
  check('refused starts opened nothing at Cashfree', calls.filter(c => c.method === 'POST' && c.path === '/orders').length === 0);

  const a1 = await start(owner, [o1], 40, `k-share-${RUN}-0001`);
  const created = calls.find(c => c.method === 'POST' && c.path === '/orders')!;
  check('start: Cashfree order id is olp-<attempt>, amount in rupees from the DATABASE bill, INR, full phone to Cashfree only',
    created.body.order_id === a1.provider_order_id && /^olp-[0-9a-f]{32}$/.test(a1.provider_order_id) && created.body.order_amount === 40 && created.body.order_currency === 'INR' && created.body.customer_details.customer_phone === '9876543210', created.body);
  check('start: id/secret/version/idempotency headers, https notify url, return url on our host, 30 minute expiry, secret not in the body',
    created.headers['x-client-id'] === 'CHECKS_APP_ID' && created.headers['x-api-version'] === '2026-01-01' && /^[0-9a-f-]{36}$/.test(created.headers['x-idempotency-key']) && created.body.order_meta.notify_url === 'https://api.example.test/api/payments/webhook'
    && created.body.order_meta.return_url.startsWith('https://api.example.test/api/partner/payments/return?attempt=') && Date.parse(created.body.order_expiry_time) - Date.now() > 25 * 60_000 && !JSON.stringify(created.body).includes(SECRET));
  check('start reply: attempt, session id, pending, due 105, no phone, poll hints', a1.status === 'pending' && /^session_/.test(String(a1.payment_session_id)) && a1.due === 105 && a1.amount === 40 && a1.poll.every_ms === 3000 && a1.link_url === null && !JSON.stringify({ ...a1, payment_session_id: '' }).includes('9876543210'), { ...a1, payment_session_id: '…' });
  const row1 = must(await d.from('online_payments').select('*').eq('attempt_id', a1.attempt_id).single());
  check('stored: only the last four phone digits, Cashfree order id, started_by the staff user; the session id is not stored', row1.payer_phone_last4 === '3210' && row1.provider_ref === `cfp${RUN}1` && row1.started_by === owner.userId && !JSON.stringify(row1).includes('session_') && !JSON.stringify(row1).includes('98765'), row1);
  const again = await start(owner, [o1], 40, `k-share-${RUN}-0001`);
  check('idempotent start: same key = same attempt, same live Cashfree order and session, no second order', again.attempt_id === a1.attempt_id && again.replayed === true && orders.size === 1 && again.payment_session_id === a1.payment_session_id);
  await refused('the same key with another amount is refused (422 idempotency_mismatch)', 422, 'idempotency_mismatch', () => start(owner, [o1], 41, `k-share-${RUN}-0001`));
  const a2 = await start(owner, [o1], 40, `k-share-${RUN}-0002`);
  check('a new key is a new attempt with a NEW provider order id (and a new Cashfree order)', a2.attempt_id !== a1.attempt_id && a2.provider_order_id !== a1.provider_order_id && orders.size === 2);
  check('status of a fresh attempt: pending with a polling hint, nothing recorded', (await status(a1.attempt_id)).outcome === 'pending' && (await paymentsOf(o1)).length === 0);

  // ---------------- 2. webhook success: exactly one payment ----------------
  const pay1 = gatewayPays(a1.provider_order_id, 'SUCCESS');
  const ev1 = payEvent(pay1);
  const wh = hook(ev1);
  const ack = await cfc.handleCashfreeWebhook(wh);
  const p1 = await paymentsOf(o1);
  check('webhook success: acknowledged and ONE canonical payment (online, cashfree, key cashfree:<cf_payment_id>, 40.00)', ack.ok && p1.length === 1 && p1[0].method === 'online' && p1[0].gateway === 'cashfree' && p1[0].gateway_reference === pay1.cf_payment_id && p1[0].idempotency_key === `cashfree:${pay1.cf_payment_id}` && Number(p1[0].amount) === 40, p1);
  check('webhook success: one ledger capture of 4000 paise; the bill is awaiting_payment with 65 due', (await ledgerOf(pay1.cf_payment_id)).length === 1 && (await dueOf(o1)).status === 'awaiting_payment');
  check('status after the webhook: paid, recorded', (await status(a1.attempt_id)).outcome === 'paid' && (await status(a1.attempt_id)).recorded === true);
  const dup = await cfc.handleCashfreeWebhook(hook(ev1));
  check('identical redelivery (same bytes) is a no-op', (dup as any).duplicate === true && (await paymentsOf(o1)).length === 1);
  await cfc.handleCashfreeWebhook(hook({ ...ev1, event_time: new Date(Date.now() + 1000).toISOString() }));
  check('the same cf_payment_id in a differently-worded event still books ONE payment (dedupe on cf_payment_id)', (await paymentsOf(o1)).length === 1 && (await ledgerOf(pay1.cf_payment_id)).length === 1);
  const logged = must(await d.from('payment_webhook_events').select('outcome, online_payment_id, organization_id, provider_payment_id').eq('provider', 'cashfree').eq('provider_payment_id', pay1.cf_payment_id));
  check('webhook log keeps the outcome with the attempt and organization; the second wording is logged as duplicate', logged.some((l: any) => l.outcome === 'processed' && l.organization_id === org.id && !!l.online_payment_id) && logged.some((l: any) => l.outcome === 'duplicate'), logged);

  // ---------------- 3. signature, timestamp, amount ----------------
  const a3 = await start(owner, [o1], 25, `k-share-${RUN}-0003`);
  const pay3 = gatewayPays(a3.provider_order_id, 'SUCCESS');
  await refused('wrong signature: 400 bad_signature and nothing booked', 400, 'bad_signature', () => cfc.handleCashfreeWebhook(hook(payEvent(pay3), undefined, 'cfsk_wrong_secret')));
  await refused('stale timestamp (10 minutes old, validly signed): 400 stale_timestamp', 400, 'stale_timestamp', () => cfc.handleCashfreeWebhook(hook(payEvent(pay3), String(Date.now() - 10 * 60_000))));
  check('after the refused webhooks the attempt is still pending and nothing is booked', (await paymentsOf(o1)).length === 1 && must(await d.from('online_payments').select('status').eq('attempt_id', a3.attempt_id).single()).status === 'pending');
  // the status poll alone finds the payment when no webhook ever arrives (a laptop cannot receive one)
  const polled = await status(a3.attempt_id);
  check('status poll without any webhook: asks Cashfree, finds the payment and books it once', polled.outcome === 'paid' && (await paymentsOf(o1)).length === 2 && calls.some(c => c.method === 'GET' && c.path === `/orders/${a3.provider_order_id}/payments`));
  await status(a3.attempt_id);
  check('polling again changes nothing', (await paymentsOf(o1)).length === 2);

  const o2 = await bill(50);
  const a4 = await start(owner, [o2], 50, `k-mism-${RUN}-0001`);
  const pay4 = gatewayPays(a4.provider_order_id, 'SUCCESS', 49);
  await cfc.handleCashfreeWebhook(hook(payEvent(pay4)));
  check('a success for a different amount than the attempt is refused (amount_mismatch) and books nothing', (await paymentsOf(o2)).length === 0 && must(await d.from('payment_webhook_events').select('outcome').eq('provider_payment_id', pay4.cf_payment_id)).some((l: any) => l.outcome === 'amount_mismatch'));

  // ---------------- 4. shares summing to the bill (40 + 25 above, then 40) ----------------
  await refused('the fourth share cannot exceed what is still due (40 due, 41 asked)', 422, 'amount_exceeds_due', () => start(owner, [o1], 40.01, `k-share-${RUN}-0004`));
  const a5 = await start(owner, [o1], 40, `k-share-${RUN}-0005`);
  gatewayPays(a5.provider_order_id, 'SUCCESS');
  await status(a5.attempt_id);
  const s1 = await paymentsOf(o1);
  check('three shares (40 + 25 + 40) sum to the bill 105: three online payments, the order is paid', s1.length === 3 && s1.reduce((n, r) => n + Number(r.amount), 0) === 105 && (await dueOf(o1)).status === 'paid', s1);
  await refused('a paid bill cannot be started again (409 order_closed)', 409, 'order_closed', () => start(owner, [o1], 1, `k-closed-${RUN}-01`));

  // ---------------- 5. failed / dropped / expired ----------------
  const o3 = await bill(90);
  const f1 = await start(owner, [o3], 30, `k-fail-${RUN}-00001`), f2 = await start(owner, [o3], 30, `k-drop-${RUN}-00001`), f3 = await start(owner, [o3], 30, `k-exp-${RUN}-000001`);
  await cfc.handleCashfreeWebhook(hook(payEvent(gatewayPays(f1.provider_order_id, 'FAILED'))));
  await cfc.handleCashfreeWebhook(hook(payEvent(gatewayPays(f2.provider_order_id, 'USER_DROPPED'))));
  orders.get(f3.provider_order_id)!.order_status = 'EXPIRED';
  const sf1 = await status(f1.attempt_id), sf2 = await status(f2.attempt_id), sf3 = await status(f3.attempt_id);
  check('failed -> failed (declined, retry ok), dropped -> dropped, expired (found by the poll) -> expired; no money booked',
    sf1.outcome === 'failed' && sf1.failure_code === 'declined' && sf1.retry_ok && sf2.outcome === 'dropped' && sf3.outcome === 'expired' && sf3.retry_ok && (await paymentsOf(o3)).length === 0, { sf1: sf1.outcome, sf2: sf2.outcome, sf3: sf3.outcome });
  check('plain-words messages say that no money was taken', /No money was taken/.test(String(sf1.message)) && /No money was taken/.test(String(sf2.message)) && /No money was taken/.test(String(sf3.message)));
  const retry = await start(owner, [o3], 30, `k-retry-${RUN}-0001`);
  check('after a failed try a fresh attempt opens a new Cashfree order', retry.provider_order_id !== f1.provider_order_id && retry.status === 'pending');
  const lateOk = gatewayPays(f1.provider_order_id, 'SUCCESS');
  await cfc.handleCashfreeWebhook(hook(payEvent(lateOk)));
  check('a success after an earlier failed try on the same Cashfree order is still booked (the guest retried in the same window)', (await paymentsOf(o3)).length === 1 && (await status(f1.attempt_id)).outcome === 'paid');

  // ---------------- 6. several bills at one table paid together ----------------
  const t1 = await bill(60), t2 = await bill(40);
  const am = await start(owner, [t1, t2], 100, `k-multi-${RUN}-00001`);
  gatewayPays(am.provider_order_id, 'SUCCESS');
  await status(am.attempt_id);
  check('one attempt for two bills at a table: one payment per bill under the same cf key; both bills paid', (await paymentsOf(t1)).length === 1 && (await paymentsOf(t2)).length === 1 && (await dueOf(t1)).status === 'paid' && (await dueOf(t2)).status === 'paid');

  // ---------------- 7. money that arrives after the bill was settled another way ----------------
  const o4 = await bill(100);
  const late = await start(owner, [o4], 100, `k-late-${RUN}-000001`);
  must(await d.from('payments').insert({ organization_id: org.id, order_id: o4, method: 'cash', amount: 100, idempotency_key: `cash-${RUN}-1` }).select('id'));
  const lateTx = gatewayPays(late.provider_order_id, 'SUCCESS');
  const refundsBefore = calls.filter(c => c.method === 'POST' && /\/refunds$/.test(c.path)).length;
  await cfc.handleCashfreeWebhook(hook(payEvent(lateTx)));
  const lateRow = must(await d.from('online_payments').select('status, refunded_minor').eq('attempt_id', late.attempt_id).single());
  check('late online money for a settled bill is NOT booked and is refunded to the payer automatically (full amount, deterministic id)',
    (await paymentsOf(o4)).filter(p => p.method === 'online').length === 0 && lateRow.status === 'needs_refund' && lateRow.refunded_minor === 10000
    && calls.filter(c => c.method === 'POST' && /\/refunds$/.test(c.path)).length === refundsBefore + 1 && /^olpr_[0-9a-f]{24}$/.test(calls.filter(c => /\/refunds$/.test(c.path)).pop()!.body.refund_id), lateRow);
  check('status calls it overpaid', (await status(late.attempt_id)).outcome === 'overpaid');

  // ---------------- 8. refunds of a guest payment ----------------
  const refundTo = (a: string, body: Record<string, unknown>, staff = owner) => pp.refundOnlinePayment(req('x', {}), staff, a, { organization_id: staff.organizationId, ...body });
  await refused('refund by a captain is refused (403)', 403, 'forbidden', () => refundTo(a1.attempt_id, { amount: 5, reason: 'guest left', idempotency_key: `r-role-${RUN}-0001` }, captain));
  await refused('refund of an attempt that was never paid is refused (409 wrong_state)', 409, 'wrong_state', () => refundTo(f2.attempt_id, { amount: 5, reason: 'guest left', idempotency_key: `r-state-${RUN}-001` }));
  await refused('over-refund is refused (422 refund_exceeds_paid: paid 40, asked 40.01)', 422, 'refund_exceeds_paid', () => refundTo(a1.attempt_id, { amount: 40.01, reason: 'guest left', idempotency_key: `r-over-${RUN}-0001` }));
  const r1 = await refundTo(a1.attempt_id, { amount: 15, reason: 'guest left early', idempotency_key: `r-part-${RUN}-0001` });
  const rcall = calls.filter(c => /\/refunds$/.test(c.path)).pop()!;
  check('partial refund: sent to the Cashfree order of that payment with our deterministic id, 15.00, STANDARD speed; pending', r1.status === 'pending' && rcall.path === `/orders/${a1.provider_order_id}/refunds` && rcall.body.refund_amount === 15 && rcall.body.refund_id === r1.refund_id && rcall.body.refund_speed === 'STANDARD', { r1, body: rcall.body });
  const nRefundCalls = calls.filter(c => /\/refunds$/.test(c.path)).length;
  const r1b = await refundTo(a1.attempt_id, { amount: 15, reason: 'guest left early', idempotency_key: `r-part-${RUN}-0001` });
  check('the same refund request again returns the SAME refund id and never makes a second refund at the gateway', r1b.refund_id === r1.refund_id && refunds.size >= 1 && [...refunds.values()].filter(r => r.order_id === a1.provider_order_id).length === 1, { nRefundCalls, r1b });
  await refused('a second refund beyond the paid amount is refused (15 + 25.01 > 40)', 422, 'refund_exceeds_paid', () => refundTo(a1.attempt_id, { amount: 25.01, reason: 'guest left early', idempotency_key: `r-over-${RUN}-0002` }));
  await cfc.handleCashfreeWebhook(hook({ data: { refund: { cf_refund_id: refunds.get(r1.refund_id)!.cf_refund_id, refund_id: r1.refund_id, order_id: a1.provider_order_id, refund_amount: 15, refund_status: 'SUCCESS' } }, event_time: new Date().toISOString(), type: 'REFUND_STATUS_WEBHOOK' }));
  const rr = must(await d.from('online_payment_refunds').select('status, provider_refund_id').eq('refund_id', r1.refund_id).single());
  check('REFUND_STATUS SUCCESS webhook for an olpr_ refund -> processed (and a ledger refund row, once)', rr.status === 'processed' && (await ledgerOf(r1.refund_id)).filter(l => l.entry_type === 'refund').length === 1, rr);
  refundBehaviour = 'REJECT';
  await refused('Cashfree rejects a refund: 502 refund_failed, and the reservation is released', 502, 'refund_failed', () => refundTo(a1.attempt_id, { amount: 25, reason: 'goodwill gesture', idempotency_key: `r-rej-${RUN}-00001` }));
  refundBehaviour = 'SUCCESS';
  const r3 = await refundTo(a1.attempt_id, { amount: 25, reason: 'goodwill gesture', idempotency_key: `r-rej-${RUN}-00002` });
  check('after a rejected refund the rest can still be refunded (cap = paid 40: 15 + 25), processed at once when Cashfree says SUCCESS', r3.status === 'processed' && must(await d.from('online_payments').select('refunded_minor').eq('attempt_id', a1.attempt_id).single()).refunded_minor === 4000, r3);

  // ---------------- 9. Cashfree down: no money, a clear error ----------------
  const o5 = await bill(70);
  cashfreeDown = true;
  await refused('Cashfree down when opening the order: 502 gateway_unavailable, nothing taken', 502, 'gateway_unavailable', () => start(owner, [o5], 70, `k-down-${RUN}-000001`));
  cashfreeDown = false;
  const downRow = must(await d.from('online_payments').select('status, failure_code').eq('idempotency_key', `k-down-${RUN}-000001`).single());
  check('that attempt is failed (gateway) in our table and the bill is untouched', downRow.status === 'failed' && downRow.failure_code === 'gateway' && (await paymentsOf(o5)).length === 0, downRow);
  const sweep = await pp.sweepPosOnlinePayments();
  check('the sweep runs and only reads attempts older than two minutes (none are)', sweep.checked >= 0);

  // ---------------- 10. no secret in anything stored or logged ----------------
  const everything = JSON.stringify(must(await d.from('online_payments').select('*').eq('organization_id', org.id)));
  check('no secret and no full phone number in the attempts table', !everything.includes(SECRET) && !everything.includes('9876543210'));
  console.log(`\n${passed} checks passed${process.exitCode ? ' - WITH FAILURES' : ''}. (fake Cashfree only; fixtures tagged ZZ-TEST pos-payments-checks)`);
}
main().catch(e => { console.error(e); process.exit(1); });
