// Checks the checkout rules on the server with no database (memory mode) and Razorpay simulated:
// food carts are one restaurant, shopping carts split into one order per store under one checkout,
// one Razorpay order per checkout, and paying / switching to cash / refunding moves every order.
// Also checks, with no database: a payment that lands after the customer chose cash is never turned into a paid order (SRV-3), the
// rate limits cannot be dodged by inventing device keys and can be backed by a shared counter (SRV-7), production with no database
// answers 503 instead of keeping orders in memory (SRV-8), and the server never uses a remote Supabase without ALLOW_REMOTE=1 or reads
// a Supabase management token (SEC-1).
// Run from frontend/:  npx tsx scripts/checkout-checks.ts
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FEATURE_ONLINE_PAYMENTS', 'ALLOW_REMOTE', 'TRUSTED_PROXY_HOPS', 'ORDERS_REQUIRE_SIGN_IN']) delete process.env[k];
process.env.SUPABASE_ACCESS_TOKEN = ['sbp', 'checks'.padEnd(40, '0')].join('_'); // a made-up management token: the server must drop it as it loads (SEC-1)
Object.assign(process.env, { RAZORPAY_KEY_ID: 'rzp_test_checks', RAZORPAY_KEY_SECRET: 'checks-secret', RAZORPAY_WEBHOOK_SECRET: 'checks-webhook' });

// Razorpay, simulated: orders it opened, and payments it would report.
const rzpOrders: { id: string; amount: number }[] = [];
const rzpPayments = new Map<string, { amount: number; method: string; order_id: string; status: string }>();
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === 'https://api.razorpay.com/v1/orders') {
    const order = { id: `order_T${rzpOrders.length + 1}`, amount: JSON.parse(String(init?.body)).amount as number };
    rzpOrders.push(order);
    return Response.json(order);
  }
  const paid = url.match(/^https:\/\/api\.razorpay\.com\/v1\/payments\/(.+)$/);
  if (paid && rzpPayments.has(paid[1])) return Response.json(rzpPayments.get(paid[1]));
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

let passed = 0;
function check(what: string, ok: boolean, detail?: unknown) {
  if (!ok) { console.error(`FAIL  ${what}`, detail ?? ''); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
}
async function refused(what: string, status: number, run: () => Promise<unknown>) {
  try { await run(); check(what, false, 'was accepted'); }
  catch (e) { const s = (e as { status?: number }).status; check(what, s === status, `${s} ${(e as Error).message}`); }
}

const hmac = (secret: string, message: string) => createHmac('sha256', secret).update(message).digest('hex');
const request = (path: string, body: unknown, who: string, key?: string, extra: Record<string, string> = {}) => new Request(`http://localhost/api/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'content-type': 'application/json', 'x-customer-key': who.padEnd(32, '0'), ...(key ? { 'idempotency-key': key } : {}), ...extra },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const address = { label: 'Home', text: 'Flat 4, Shivaji Chowk, Latur 413512', lat: 18.4088, lng: 76.5604, notes: 'Ring twice' };
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

async function main() {
  const { quote } = await import('../server/pricing');
  const store = await import('../server/store');
  const pay = await import('../server/payments');

  // ---------- The bill, per store ----------
  const food = await quote('latur', [{ id: 'f1', qty: 2 }], null);
  check('food bill: one restaurant, one store group', food.kind === 'food' && food.groups.length === 1 && food.groups[0].store_id === 'mcdonalds');
  check('food bill: 5% GST added, free delivery at ₹258', food.gst_added.total === 12.9 && food.delivery_fee === 0 && food.total === 270.9, food.total);

  const mixed = await quote('latur', [{ id: 'p1', qty: 2 }, { id: 'p2', qty: 1 }], null);
  check('shopping bill: two stores, two groups', mixed.kind === 'shopping' && mixed.groups.map(g => g.store_id).join() === 's1,s2');
  check('shopping bill: delivery fee per store (₹15 + ₹15)', mixed.groups.every(g => g.delivery_fee === 15) && mixed.delivery_fee === 30);
  check('shopping bill: total is the sum of the store totals', mixed.total === 112 && mixed.total === sum(mixed.groups.map(g => g.total)), mixed.total);

  const coupon = await quote('latur', [{ id: 'p1', qty: 2 }, { id: 'p2', qty: 1 }], 'WELCOME');
  check('coupon counts against the checkout and is shared between stores', coupon.discount === 25 && sum(coupon.groups.map(g => g.discount)) === 25, coupon.groups.map(g => g.discount));
  check('coupon: store totals still add up to the checkout total', coupon.total === 87 && sum(coupon.groups.map(g => g.total)) === 87, coupon.total);

  await refused('food from two restaurants is refused (quote)', 409, () => quote('latur', [{ id: 'f1', qty: 1 }, { id: 'f2', qty: 1 }], null));
  await refused('food and shopping in one checkout is refused', 409, () => quote('latur', [{ id: 'f1', qty: 1 }, { id: 'p1', qty: 1 }], null));

  // ---------- Cash on delivery ----------
  const one = await store.createCheckout(request('checkouts', { items: [{ id: 'f1', qty: 2 }], total: 270.9, address }, 'food-customer', 'food-key-0001'), 'latur');
  check('single-store food checkout: one order under the checkout', one.orders.length === 1 && one.orders[0].checkout_id === one.id && one.kind === 'food');
  check('the order carries the delivery address, point and notes', JSON.stringify(one.orders[0].address) === JSON.stringify(address));
  check('cash on delivery, not charged', one.payment_method === 'cod' && one.orders[0].payment_status === 'not_charged');

  const two = await store.createCheckout(request('checkouts', { items: [{ id: 'p1', qty: 2 }, { id: 'p2', qty: 1 }], total: 112, address }, 'shop-customer', 'shop-key-0001'), 'latur');
  check('mixed cart of 2 stores: 2 orders, one checkout id', two.orders.length === 2 && two.orders.every(o => o.checkout_id === two.id));
  check('each store sees only its own items', two.orders[0].store_id === 's1' && two.orders[0].items.every(i => i.id === 'p1') && two.orders[1].store_id === 's2' && two.orders[1].items.every(i => i.id === 'p2'));
  check('store orders add up to the checkout total', sum(two.orders.map(o => o.total)) === two.total && two.total === 112);
  const listed = await store.listOrders(request('orders', undefined, 'shop-customer'));
  check('My Orders lists both store orders with the shared checkout id', listed.length === 2 && listed.every(o => o.checkout_id === two.id && o.store_name));
  const fetched = await store.getCheckout(request(`checkouts/${two.id}`, undefined, 'shop-customer'), two.id);
  check('GET checkout returns the checkout with both orders', fetched.orders.length === 2 && fetched.total === 112);
  await refused('another device cannot open the checkout', 404, () => store.getCheckout(request(`checkouts/${two.id}`, undefined, 'someone-else'), two.id));
  await refused('another device cannot open a store order', 404, () => store.getOrder(request(`orders/${two.orders[0].id}`, undefined, 'someone-else'), two.orders[0].id));

  const again = await store.createCheckout(request('checkouts', { items: [{ id: 'p1', qty: 2 }, { id: 'p2', qty: 1 }], total: 112, address }, 'shop-customer', 'shop-key-0001'), 'latur');
  check('a retry with the same key returns the same checkout, no new orders', again.id === two.id && (await store.listOrders(request('orders', undefined, 'shop-customer'))).length === 2);
  await refused('the same key for a different cart is refused', 409, () => store.createCheckout(request('checkouts', { items: [{ id: 'p1', qty: 1 }], total: 40, address }, 'shop-customer', 'shop-key-0001'), 'latur'));

  await refused('server enforces one restaurant per food checkout', 409, () => store.createCheckout(request('checkouts', { items: [{ id: 'f1', qty: 1 }, { id: 'f2', qty: 1 }], address }, 'two-restaurants', 'rest-key-0001'), 'latur'));
  await refused('address text too short is refused', 400, () => store.createCheckout(request('checkouts', { items: [{ id: 'p1', qty: 1 }], address: { ...address, text: 'x' } }, 'bad-address-1'), 'latur'));
  await refused('delivery notes over 300 characters are refused', 400, () => store.createCheckout(request('checkouts', { items: [{ id: 'p1', qty: 1 }], address: { ...address, notes: 'n'.repeat(301) } }, 'bad-address-2'), 'latur'));
  await refused('a map point that is not numbers is refused', 400, () => store.createCheckout(request('checkouts', { items: [{ id: 'p1', qty: 1 }], address: { ...address, lat: '18.4' } }, 'bad-address-3'), 'latur'));
  const pointless = await store.createCheckout(request('checkouts', { items: [{ id: 'p1', qty: 1 }], address: { label: '', text: 'Near the bus stand, Latur' } }, 'no-point'), 'latur');
  check('an address without a map point is accepted', pointless.orders[0].address?.lat === null && pointless.orders[0].address?.text === 'Near the bus stand, Latur');
  const legacy = await store.createOrder(request('orders', { items: [{ id: 'p1', qty: 1 }, { id: 'p2', qty: 1 }] }, 'old-app-version', 'old-key-0001'), 'latur');
  check('older app versions (no address, POST /orders) still order, and get the first order back', !!legacy.checkout_id && legacy.store_id === 's1' && legacy.address === null);

  // ---------- Online: one Razorpay order per checkout ----------
  const cart = { items: [{ id: 'p1', qty: 2 }, { id: 'p2', qty: 1 }], total: 112, address, payment_method: 'upi', upi_app: 'google_pay' };
  const started = await pay.startPayment(request('payments/order', cart, 'online-customer', 'online-key-01'), 'latur');
  check('one Razorpay order for the checkout total (sum of both store orders)', rzpOrders.length === 1 && rzpOrders[0].amount === 11200 && started.amount === 11200, rzpOrders);
  check('payment start answers the checkout id and both order ids', started.order_ids.length === 2 && started.order_id === started.order_ids[0] && !!started.checkout_id);
  const restarted = await pay.startPayment(request('payments/order', { ...cart, payment_method: 'card' }, 'online-customer', 'online-key-01'), 'latur');
  check('a retry (other method, same key) reuses the same Razorpay order', rzpOrders.length === 1 && restarted.razorpay_order_id === started.razorpay_order_id);
  check('an unpaid checkout stays out of My Orders', (await store.listOrders(request('orders', undefined, 'online-customer'))).length === 0);

  const paymentId = 'pay_T1';
  rzpPayments.set(paymentId, { amount: 11200, method: 'upi', order_id: started.razorpay_order_id!, status: 'captured' });
  await refused('a forged signature is refused', 400, () => pay.verifyPayment(request('payments/verify', { checkout_id: started.checkout_id, razorpay_order_id: started.razorpay_order_id, razorpay_payment_id: paymentId, razorpay_signature: 'ab'.repeat(32) }, 'online-customer')));
  const signature = hmac('checks-secret', `${started.razorpay_order_id}|${paymentId}`);
  await refused('another device cannot verify this checkout', 404, () => pay.verifyPayment(request('payments/verify', { checkout_id: started.checkout_id, razorpay_order_id: started.razorpay_order_id, razorpay_payment_id: paymentId, razorpay_signature: signature }, 'someone-else')));
  const verified = await pay.verifyPayment(request('payments/verify', { checkout_id: started.checkout_id, razorpay_order_id: started.razorpay_order_id, razorpay_payment_id: paymentId, razorpay_signature: signature }, 'online-customer'));
  const paidOrders = await store.listOrders(request('orders', undefined, 'online-customer'));
  check('verify marks every order in the checkout paid', verified.payment_status === 'paid' && paidOrders.length === 2 && paidOrders.every(o => o.payment_status === 'paid' && o.payment_method === 'upi'));

  // Older app versions verify with an order id instead of the checkout id.
  const oldStart = await pay.startPayment(request('payments/order', cart, 'old-online', 'old-online-01'), 'latur');
  rzpPayments.set('pay_T2', { amount: 11200, method: 'card', order_id: oldStart.razorpay_order_id!, status: 'captured' });
  const oldVerified = await pay.verifyPayment(request('payments/verify', { order_id: oldStart.order_ids[1], razorpay_order_id: oldStart.razorpay_order_id, razorpay_payment_id: 'pay_T2', razorpay_signature: hmac('checks-secret', `${oldStart.razorpay_order_id}|pay_T2`) }, 'old-online'));
  check('verify by an order id (older app) pays the whole checkout', oldVerified.checkout_id === oldStart.checkout_id && (await store.listOrders(request('orders', undefined, 'old-online'))).every(o => o.payment_status === 'paid'));

  // The webhook: Razorpay tells the server directly.
  const hooked = await pay.startPayment(request('payments/order', cart, 'webhook-customer', 'webhook-key-1'), 'latur');
  const webhook = (event: string, entity: object, id: string) => {
    const raw = JSON.stringify({ event, payload: { payment: { entity } } });
    return pay.handleWebhook(new Request('http://localhost/api/payments/webhook', { method: 'POST', body: raw, headers: { 'x-razorpay-signature': hmac('checks-webhook', raw), 'x-razorpay-event-id': id } }));
  };
  await webhook('payment.captured', { id: 'pay_T3', order_id: hooked.razorpay_order_id, amount: 11200, method: 'netbanking', notes: { checkout_id: hooked.checkout_id } }, 'evt_1');
  const hookedOrders = await store.listOrders(request('orders', undefined, 'webhook-customer'));
  check('webhook payment.captured marks every order in the checkout paid', hookedOrders.length === 2 && hookedOrders.every(o => o.payment_status === 'paid' && o.payment_method === 'netbanking'));

  const short = await pay.startPayment(request('payments/order', cart, 'short-payer', 'short-key-001'), 'latur');
  await webhook('payment.captured', { id: 'pay_T4', order_id: short.razorpay_order_id, amount: 5600, method: 'upi' }, 'evt_2');
  check('a payment for less than the checkout total does not mark it paid', (await store.findPayment('id', short.checkout_id))?.payment_status === 'pending');

  const failing = await pay.startPayment(request('payments/order', cart, 'failing-payer', 'failing-key-1'), 'latur');
  await webhook('payment.failed', { id: 'pay_T5', order_id: failing.razorpay_order_id, amount: 11200, error_description: 'Bank declined' }, 'evt_3');
  check('payment.failed marks the checkout failed', (await store.findPayment('id', failing.checkout_id))?.payment_status === 'failed');
  const cash = await pay.switchToCash(request('payments/cod', { order_id: failing.order_ids[0] }, 'failing-payer'));
  const cashOrders = await store.listOrders(request('orders', undefined, 'failing-payer'));
  check('switching to cash (by an order id) moves every order to pay on delivery', cash.payment_status === 'not_charged' && cashOrders.length === 2 && cashOrders.every(o => o.payment_method === 'cod' && o.payment_status === 'not_charged'));

  const page = await pay.checkoutPage(request(`payments/checkout-page?order=${short.order_ids[1]}&method=upi`, undefined, 'short-payer'));
  check('the phone payment page opens for the checkout total from an order id', page.status === 200 && (await page.text()).includes('"amount":11200'));

  const refundRaw = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_T1', payment_id: 'pay_T3', amount: 11200 } } } });
  await pay.handleWebhook(new Request('http://localhost/api/payments/webhook', { method: 'POST', body: refundRaw, headers: { 'x-razorpay-signature': hmac('checks-webhook', refundRaw), 'x-razorpay-event-id': 'evt_4' } }));
  check('a full refund marks every order in the checkout refunded', (await store.listOrders(request('orders', undefined, 'webhook-customer'))).every(o => o.payment_status === 'refunded'));

  // ---------- SRV-3: a payment that arrives after the customer switched to cash ----------
  // `failing` was switched to pay on delivery above. Its Razorpay order is still open, so the customer (or a slow bank) can still pay it.
  const lateId = 'pay_T6';
  rzpPayments.set(lateId, { amount: 11200, method: 'upi', order_id: failing.razorpay_order_id!, status: 'captured' });
  await webhook('payment.captured', { id: lateId, order_id: failing.razorpay_order_id, amount: 11200, method: 'upi', notes: { checkout_id: failing.checkout_id } }, 'evt_late_1');
  const afterLate = await store.findPayment('id', failing.checkout_id);
  check('a late capture after "switch to cash" does not turn the checkout into a paid one', afterLate?.payment_method === 'cod' && afterLate.payment_status === 'not_charged' && afterLate.razorpay_payment_id === null, afterLate);
  check('...and every order in it is still cash on delivery, not paid', (await store.listOrders(request('orders', undefined, 'failing-payer'))).every(o => o.payment_method === 'cod' && o.payment_status === 'not_charged'));
  await refused('the app reporting that late payment (verify) is told the order is cash on delivery: 409, not "paid"', 409, () => pay.verifyPayment(request('payments/verify', { checkout_id: failing.checkout_id, razorpay_order_id: failing.razorpay_order_id, razorpay_payment_id: lateId, razorpay_signature: hmac('checks-secret', `${failing.razorpay_order_id}|${lateId}`) }, 'failing-payer')));
  check('verify did not change it either', (await store.findPayment('id', failing.checkout_id))?.payment_status === 'not_charged');

  // ---------- SRV-7: limits that a client-chosen header cannot dodge ----------
  const limitsMap = () => (globalThis as unknown as { __onecityLimits?: Map<string, unknown> }).__onecityLimits!;
  const { setSharedLimitStore } = await import('../server/limits');
  limitsMap().clear();
  process.env.TRUSTED_PROXY_HOPS = '1';
  const order = (device: string, ip: string) => store.createCheckout(request('checkouts', { items: [{ id: 'p1', qty: 1 }], address }, device, undefined, { 'x-forwarded-for': `${device}, ${ip}` }), 'latur');
  let placed = 0, blocked = 0;
  for (let i = 0; i < 12; i++) { try { await order(`rotate-${i}`, '198.51.100.7'); placed++; } catch (e) { if ((e as { status?: number }).status === 429) blocked++; else throw e; } }
  check('inventing a new device key for every order does not get past the address limit (8 a minute without an account)', placed === 8 && blocked === 4, { placed, blocked });
  await order('someone-on-another-address', '203.0.113.50').then(() => check('another address is not affected', true), e => check('another address is not affected', false, e));
  const shared = { keys: [] as string[] };
  limitsMap().clear();
  setSharedLimitStore(async key => { shared.keys.push(key); return { allowed: false, retryAfter: 7 }; });
  let denied: { status?: number; headers?: Record<string, string> } = {};
  try { await order('shared-store-1', '198.51.100.20'); } catch (e) { denied = e as typeof denied; }
  check('the shared counter can refuse a request the local one would have allowed (429 with Retry-After)', denied.status === 429 && denied.headers?.['Retry-After'] === '7', denied);
  check('only a hash of the caller (never the address or the device key) reaches the shared counter', shared.keys.length >= 1 && shared.keys.every(k => /^order:[0-9a-f]{40}$/.test(k)) && !shared.keys.some(k => k.includes('198.51') || k.includes('shared-store')), shared.keys);
  limitsMap().clear();
  setSharedLimitStore(async () => { throw new Error('the counter is down'); });
  await order('shared-store-2', '198.51.100.21').then(() => check('a shared counter that fails does not stop orders (the local limits still apply)', true), e => check('a shared counter that fails does not stop orders', false, e));
  setSharedLimitStore(null);
  limitsMap().clear();
  process.env.ORDERS_REQUIRE_SIGN_IN = '1';
  await refused('ORDERS_REQUIRE_SIGN_IN=1: a device key alone cannot place an order (401)', 401, () => order('no-account', '198.51.100.30'));
  delete process.env.ORDERS_REQUIRE_SIGN_IN;
  delete process.env.TRUSTED_PROXY_HOPS;
  limitsMap().clear();
  const { limit } = await import('../server/http');
  for (let i = 0; i < 51_000; i++) limit(`subject-${i}`, 'prune', 5, 1);
  await new Promise(r => setTimeout(r, 10));
  limit('one-more', 'prune', 5, 60_000);
  check('the in-process limiter forgets expired buckets and stays bounded', limitsMap().size < 50_000, limitsMap().size);
  limitsMap().clear();

  // ---------- SEC-1: the server's environment ----------
  check('the Supabase management token is removed from the environment when the server loads', process.env.SUPABASE_ACCESS_TOKEN === undefined);
  const sources = (dir: string) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter(f => f.isFile() && /\.(ts|tsx|js|mjs)$/.test(f.name)).map(f => `${f.parentPath}/${f.name}`);
  const readers = [...sources('server'), ...sources('app/api')].filter(f => readFileSync(f, 'utf8').split('\n').some(l => l.includes('SUPABASE_ACCESS_TOKEN') && !l.trimStart().startsWith('//') && !l.includes('deleteProperty')));
  check('no server or route file reads SUPABASE_ACCESS_TOKEN', readers.length === 0, readers);
  const dbmod = await import('../server/db');
  const envmod = await import('../server/env');
  Object.assign(process.env, { SUPABASE_URL: 'https://abcdefghij.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-checks' });
  check('a hosted Supabase project is not used without ALLOW_REMOTE=1 (no database, not a crash)', dbmod.dbConfigured() === false && envmod.supabaseUrl() === null);
  let refusedDb: { status?: number } = {};
  try { dbmod.db(); } catch (e) { refusedDb = e as typeof refusedDb; }
  check('...and db() answers 503 instead of connecting to it', refusedDb.status === 503, refusedDb);
  process.env.ALLOW_REMOTE = '1';
  check('with ALLOW_REMOTE=1 the hosted project is allowed', dbmod.dbConfigured() === true && envmod.supabaseUrl() === 'https://abcdefghij.supabase.co');
  delete process.env.ALLOW_REMOTE;
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  check('a local Supabase needs no flag', dbmod.dbConfigured() === true);
  check('only loopback counts as local (a look-alike host does not)', envmod.isLocalUrl('http://localhost:54321') && envmod.isLocalUrl('http://[::1]:54321') && envmod.isLocalUrl('http://x.localhost:3000') && !envmod.isLocalUrl('https://localhost.evil.example') && !envmod.isLocalUrl('http://127.0.0.1.evil.example') && !envmod.isLocalUrl('https://x.supabase.co') && !envmod.isLocalUrl('nonsense'));
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];

  // ---------- SRV-9 P3-10 and P3-5: body size is checked while reading, and credentials never reach the logs ----------
  const { readBody, redact } = await import('../server/http');
  await refused('a body over the limit is refused (413) without being parsed', 413, () => readBody(new Request('http://localhost/api/x', { method: 'POST', body: JSON.stringify({ pad: 'x'.repeat(70_000) }) })));
  await refused('a declared Content-Length over the limit is refused (413) before the body is read', 413, () => readBody(new Request('http://localhost/api/x', { method: 'POST', body: '{}', headers: { 'content-length': '999999' } })));
  check('a small body is still read', (await readBody<{ a: number }>(new Request('http://localhost/api/x', { method: 'POST', body: '{"a":1}' }))).a === 1);
  const masked = redact(new Error(`request to https://maps.googleapis.com/maps/api/geocode/json?latlng=1,2&key=${['AI', 'za', 'FakeKeyForChecks'.padEnd(35, 'x')].join('')} failed with Bearer abcdefghijklmnop1234 and ${['ey', 'J', 'hbGciOiJIUzI1NiJ9.eyJzdWIiOiJjaGVja3MifQ.fakesignaturefakesig'].join('')}`));
  check('redact masks a Google key, a bearer token and a JWT', !/AIza|abcdefghijklmnop1234|eyJhbGci/.test(masked) && masked.includes('latlng=1,2'), masked);

  // ---------- SRV-8: production never keeps orders, support or webhooks in memory ----------
  const nodeEnv = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: 'production' });
  const prodRefusal = async (what: string, run: () => Promise<unknown>) => {
    try { await run(); check(what, false, 'was accepted'); } catch (e) { const x = e as { status?: number; code?: string }; check(what, x.status === 503 && x.code === 'database_unavailable', `${x.status} ${x.code}`); }
  };
  await prodRefusal('production with no database: a cash order is refused (503), not held in memory', () => store.createCheckout(request('checkouts', { items: [{ id: 'p1', qty: 1 }], address }, 'prod-order'), 'latur'));
  await prodRefusal('production with no database: a help request is refused', () => store.createSupportRequest(request('support-requests', { topic: 'order', message: 'Where is my order, please?' }, 'prod-support')));
  await prodRefusal('production with no database: a booking enquiry is refused', () => store.createEnquiry(request('booking-enquiries', { event_id: 'x', slot: 'x', date: '2026-01-01', name: 'Asha', phone: '9876543210', guests: 2 }, 'prod-enquiry')));
  await prodRefusal('production with no database: reading orders is refused', () => store.listOrders(request('orders', undefined, 'prod-orders')));
  await prodRefusal('production with no database: the catalogue is refused (no sample data in production)', () => quote('latur', [{ id: 'f1', qty: 1 }], null));
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_P1', order_id: 'order_P1', amount: 100 } } } });
  await prodRefusal('production with no database: a webhook is refused, so Razorpay retries it (not remembered in memory)', () => pay.handleWebhook(new Request('http://localhost/api/payments/webhook', { method: 'POST', body: raw, headers: { 'x-razorpay-signature': hmac('checks-webhook', raw), 'x-razorpay-event-id': 'evt_prod_1' } })));
  if (nodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else process.env.NODE_ENV = nodeEnv;
  check('outside production the same orders still work in memory (UI work with no .env)', (await store.createSupportRequest(request('support-requests', { topic: 'order', message: 'Where is my order, please?' }, 'dev-support'))).status === 'saved_for_review');

  // Imports every route the change touches, so a broken import shows up here.
  await Promise.all(['../app/api/checkouts/index+api', '../app/api/checkouts/[id]+api', '../app/api/orders/index+api', '../app/api/cart/quote+api', '../app/api/payments/order+api'].map(p => import(p)));
  check('route modules import cleanly', true);

  console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
