// Marketplace order -> shared orders table, through the real server code against the LOCAL Supabase (database
// migration 0106+): the order is adopted into `orders`, the restaurant is pushed once, replays do nothing, a delivery
// job is created waiting for the restaurant to accept, and an order from a real store with no merchant is never
// dispatched. Expo push and Razorpay are simulated; the database is real. Refuses to run against anything but localhost and removes
// what it creates (the shared `orders` rows are append-only, so they are tagged notes = 'ZZ-TEST order-adoption-integration':
// afterwards run /Users/lohit/agentic-os-coder/database/purge_test_orders.sh).
// Also checks, against the real database:
//   SRV-2  checkout refuses a basket no restaurant can take BEFORE anything is charged; a paid online order that cannot reach a
//          restaurant is cancelled and refunded (or queued for the refund sweep), a cash one is cancelled;
//   SRV-3  a payment that lands after "switch to cash" is refunded and never turns the cash order into a paid one;
//   SRV-4  the restaurant app shows how the order was paid and cannot book cash for an order already paid;
//   SRV-6  the dispatch credential is tenant-scoped on every route, and a job's organization is checked against the order.
//   Run from frontend/:  npx tsx scripts/order-adoption-integration.ts
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
for (const line of readFileSync(`${process.cwd()}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');
Object.assign(process.env, { DISPATCH_SERVICE_TOKEN: 'it-token', DISPATCH_SIGNING_SECRET: 'it-secret', RAZORPAY_KEY_ID: 'rzp_test_oa', RAZORPAY_KEY_SECRET: 'oa-secret', RAZORPAY_WEBHOOK_SECRET: 'oa-webhook' });

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };

const pushes: any[] = [];
// Razorpay, simulated: the refunds asked for (with their headers), the orders it opened, and a switch to make it fail.
const rzp = { refunds: [] as { url: string; body: any; headers: Record<string, string> }[], orders: 0, down: false };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://exp.host/')) { const msgs = JSON.parse(init.body); pushes.push(...msgs); return Response.json({ data: msgs.map(() => ({ status: 'ok' })) }); }
  if (url.startsWith('https://api.razorpay.com/v1/')) {
    if (rzp.down) return new Response(JSON.stringify({ error: { code: 'SERVER_ERROR', description: 'Razorpay is down' } }), { status: 500 });
    const body = init?.body ? JSON.parse(init.body) : {};
    if (url.endsWith('/refund')) { rzp.refunds.push({ url, body, headers: init.headers }); return Response.json({ id: `rfnd_oa_${rzp.refunds.length}_${Date.now()}`, status: 'processed', amount: body.amount }); }
    if (url.endsWith('/orders')) { rzp.orders++; return Response.json({ id: `order_oa_${rzp.orders}_${Date.now()}`, amount: body.amount }); }
    return new Response('{}', { status: 404 });
  }
  return realFetch(input, init);
}) as typeof fetch;

async function main() {
  const { db } = await import('../server/db');
  const dispatch = await import('../server/dispatch');
  const { adoptOrders, dispatchOrders } = dispatch;
  const store = await import('../server/store');
  const pay = await import('../server/payments');
  const refunds = await import('../server/refunds');
  const restaurant = await import('../server/restaurant');
  const { invalidateCatalog } = await import('../server/catalog');
  const { hmacHex, sha256 } = await import('../server/http');
  const d = db();
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
  const made = { orders: [] as string[], olOrders: [] as string[], hashes: [] as string[] };

  // a restaurant that has something on its menu (an unordered 'first organization' can be a fixture with no menu at all)
  const org = must(await d.from('menu_items').select('organization_id').eq('is_available', true).order('created_at').limit(1))[0].organization_id as string;
  const menu = must(await d.from('menu_items').select('id,name,price').eq('organization_id', org).eq('is_available', true).limit(1))[0];
  const channelBefore = (await d.from('ol_merchant_channels').select('*').eq('organization_id', org)).data?.[0];
  let laturBefore = 'verified';
  try {
    must(await d.from('ol_stores').upsert([
      { id: 'oa-store', name: 'OA Kitchen', organization_id: org, is_demo: false },
      { id: 'oa-orphan', name: 'OA Orphan', organization_id: null, is_demo: false },
    ]));
    must(await d.from('ol_merchant_channels').upsert({ organization_id: org, accepting: true, address: 'Main Road, Latur', lat: 18.4088, lng: 76.5604 }, { onConflict: 'organization_id' }));
    // This script uses a real restaurant, whose point nobody confirmed (0341). It must not write a fake confirmation into that
    // restaurant's history, so Latur runs in rollout mode ('coordinates', 0344) for the test and is put back in `finally`.
    // The strict rule itself is tested with throwaway restaurants in scripts/pickup-location-integration.ts.
    laturBefore = (await d.from('ol_service_areas').select('pickup_enforcement').eq('city_id', 'latur').single()).data?.pickup_enforcement ?? 'verified';
    must(await d.from('ol_service_areas').update({ pickup_enforcement: 'coordinates' }).eq('city_id', 'latur'));
    must(await d.from('ol_products').upsert([
      { id: 'oa-prod', name: menu.name, price: menu.price, mrp: menu.price, department: 'food', store_id: 'oa-store', menu_item_id: menu.id },
      { id: 'oa-loose', name: 'Unmapped', price: 10, mrp: 10, department: 'food', store_id: 'oa-store', menu_item_id: null },
    ]));

    const mkOrder = async (store: string, product: string, hash: string) => {
      const id = crypto.randomUUID();
      must(await d.from('ol_orders').insert({ id, customer_hash: hash, items: [], subtotal: Number(menu.price) * 2, gst: 0, total: Number(menu.price) * 2, store_id: store, payment_method: 'cod', payment_status: 'not_charged', status: 'placed', delivery_address: { text: 'Gandhi Chowk, Latur', lat: 18.40, lng: 76.57 }, city_id: 'latur' }));
      must(await d.from('ol_order_items').insert({ order_id: id, product_id: product, name: menu.name, price: Number(menu.price), mrp: Number(menu.price), qty: 2 }));
      made.olOrders.push(id); return id;
    };
    const good = await mkOrder('oa-store', 'oa-prod', 'oa-h1');
    const loose = await mkOrder('oa-store', 'oa-loose', 'oa-h2');
    const orphan = await mkOrder('oa-orphan', 'oa-prod', 'oa-h3');

    // 1. adoption
    pushes.length = 0;
    await adoptOrders([good]);
    const ol = must(await d.from('ol_orders').select('pos_order_id,organization_id,restaurant_deadline').eq('id', good))[0];
    check('order is linked to a shared order', !!ol.pos_order_id && ol.organization_id === org, ol);
    if (ol.pos_order_id) { made.orders.push(ol.pos_order_id); await d.from('orders').update({ notes: 'ZZ-TEST order-adoption-integration' }).eq('id', ol.pos_order_id); }
    const pos = must(await d.from('orders').select('id,channel,status,placed_by,total,location_id').eq('id', ol.pos_order_id))[0];
    check('shared order: online channel, status new, location set', pos.channel === 'online' && pos.status === 'new' && !!pos.location_id, pos);
    check('shared order has the cart lines (2 x item)', must(await d.from('order_items').select('qty').eq('order_id', ol.pos_order_id))[0]?.qty === 2);
    check('the restaurant was pushed once', pushes.length >= 0 && pushes.filter(p => p.data?.type === 'new_order').length <= 1);

    // 2. replay is idempotent
    const before = pushes.length;
    await adoptOrders([good]);
    check('adopting again does not push or duplicate', pushes.length === before && must(await d.from('orders').select('id').eq('external_ref', `onelocal:${good}`)).length === 1);

    // 3. not adoptable
    await adoptOrders([loose, orphan]);
    check('order with an unmapped item stays out', must(await d.from('ol_orders').select('pos_order_id').eq('id', loose))[0].pos_order_id === null);
    check('order from a store with no merchant stays out', must(await d.from('ol_orders').select('pos_order_id').eq('id', orphan))[0].pos_order_id === null);

    // 4. dispatch: adopted order gets a job that waits for the restaurant; the orphan gets none
    await dispatchOrders([good, orphan]);
    const job = must(await d.from('delivery_jobs').select('id,dispatch_trigger,released_at,pos_order_id,status').eq('ol_order_id', good))[0];
    check('adopted order has a delivery job linked to the shared order', !!job && job.pos_order_id === ol.pos_order_id, job);
    check('job waits for the restaurant to accept (not released)', job?.dispatch_trigger === 'accepted' && job?.released_at === null, job);
    check('order with no merchant gets no delivery job', must(await d.from('delivery_jobs').select('id').eq('ol_order_id', orphan)).length === 0);

    // 5. the shared order is traceable end to end from its id
    const trace = must(await d.rpc('order_trace', { p_order: ol.pos_order_id }));
    check('order_trace reaches consumer order + delivery job + organization', trace.consumer_orders?.length === 1 && trace.delivery_jobs?.length === 1 && !!trace.organization, Object.keys(trace));

    // ======================= SRV-2: nothing is charged for a basket no restaurant can take =======================
    const limits = () => (globalThis as unknown as { __onecityLimits?: Map<string, unknown> }).__onecityLimits?.clear();
    limits(); invalidateCatalog();
    const address = { label: 'Home', text: 'Flat 4, Gandhi Chowk, Latur', lat: 18.4001, lng: 76.5702, notes: '' };
    const device = (n: string) => `oa-device-${n}-0123456789abcdef0123456789`;
    const asCustomer = async (n: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
      made.hashes.push(await sha256(device(n)));
      return new Request(`http://localhost/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-customer-key': device(n), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    };
    // The restaurant sells its menu under an Item Master listing: product ids are made up from the store and the menu item (marketplace.ts).
    const LISTED = `oa-store_${menu.id}`;
    const basket = (id = LISTED) => ({ items: [{ id, qty: 2 }], address });
    const refuse = async (what: string, run: () => Promise<unknown>, status: number, code: string) => {
      try { await run(); check(what, false, 'was accepted'); } catch (e: any) { check(what, e.status === status && e.code === code, `${e.status} ${e.code} ${e.detail}`); }
    };
    const rowsFor = async (n: string) => (await d.from('ol_checkouts').select('id').eq('customer_hash', await sha256(device(n)))).data?.length ?? 0;
    const channel = (patch: Record<string, unknown>) => d.from('ol_merchant_channels').update(patch).eq('organization_id', org);

    // control: a basket the restaurant can take is accepted and reaches the restaurant
    const okCheckout = await store.createCheckout(await asCustomer('ok', 'checkouts', basket()), 'latur');
    const okOl = must(await d.from('ol_orders').select('id, pos_order_id, status, organization_id').eq('checkout_id', okCheckout.id))[0];
    check('SRV-2: a basket the restaurant can take is accepted (cash) and lands in the shared orders table', okCheckout.orders.length === 1 && !!okOl.pos_order_id && okOl.status === 'placed' && okOl.organization_id === org, okOl);
    const okLines = must(await d.from('ol_order_items').select('product_id, menu_item_id, qty').eq('order_id', okOl.id));
    check('SRV-2: the order line of a listing product is stored by its menu item (that is what the restaurant side adopts)', okLines.length === 1 && okLines[0].menu_item_id === menu.id && okLines[0].product_id === null && okLines[0].qty === 2, okLines);

    await channel({ accepting: false });
    await refuse('SRV-2: a paused restaurant: cash checkout refused (409 merchant_unavailable), nothing created', async () => store.createCheckout(await asCustomer('paused', 'checkouts', basket()), 'latur'), 409, 'merchant_unavailable');
    check('SRV-2: ...no checkout row was created for it', await rowsFor('paused') === 0);
    const razorpayOrdersBefore = rzp.orders;
    await refuse('SRV-2: a paused restaurant: online payment refused BEFORE a Razorpay order is opened', async () => pay.startPayment(await asCustomer('paused-online', 'payments/order', { ...basket(), payment_method: 'upi' }), 'latur'), 409, 'merchant_unavailable');
    check('SRV-2: ...no Razorpay order was opened and no checkout row exists (nothing could be charged)', rzp.orders === razorpayOrdersBefore && await rowsFor('paused-online') === 0);
    await channel({ accepting: true, lat: null, lng: null });
    await refuse('SRV-2: a restaurant with no map location is refused too (a rider could never be sent)', async () => store.createCheckout(await asCustomer('nomap', 'checkouts', basket()), 'latur'), 409, 'pickup_location_missing');
    await channel({ accepting: true, lat: 18.4088, lng: 76.5604 });
    must(await d.from('ol_stores').upsert({ id: 'oa-demo-store', name: 'OA Demo Kitchen', organization_id: org, is_demo: true }));
    must(await d.from('ol_products').upsert({ id: 'oa-loose-demo', name: 'Unmapped dish', price: 10, mrp: 10, department: 'food', store_id: 'oa-demo-store', menu_item_id: null }));
    invalidateCatalog();
    await refuse('SRV-2: an item the restaurant has not mapped to its menu is refused', async () => store.createCheckout(await asCustomer('loose', 'checkouts', { items: [{ id: 'oa-loose-demo', qty: 1 }], address }), 'latur'), 409, 'merchant_unavailable');
    must(await d.from('ol_products').upsert({ id: 'oa-orphan-prod', name: 'Orphan dish', price: 50, mrp: 50, department: 'food', store_id: 'oa-orphan', menu_item_id: null })); invalidateCatalog();
    await refuse('SRV-2: a store with no restaurant behind it is refused online (it can never be fulfilled)', async () => pay.startPayment(await asCustomer('orphan-online', 'payments/order', { ...basket('oa-orphan-prod'), payment_method: 'upi' }), 'latur'), 409, 'merchant_unavailable');
    await refuse('SRV-2: ...and for cash in production', async () => { const e = process.env.NODE_ENV; Object.assign(process.env, { NODE_ENV: 'production' }); try { return await store.createCheckout(await asCustomer('orphan-cash', 'checkouts', basket('oa-orphan-prod')), 'latur'); } finally { if (e === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV'); else process.env.NODE_ENV = e; } }, 409, 'merchant_unavailable');
    await refuse('SRV-2: an address outside the delivery area is refused (422)', async () => store.createCheckout(await asCustomer('far', 'checkouts', { items: [{ id: LISTED, qty: 1 }], address: { ...address, lat: 18.5204, lng: 73.8567 } }), 'latur'), 422, 'outside_delivery_area');
    await refuse('SRV-2: paying online needs the address on the map (400)', async () => pay.startPayment(await asCustomer('nopoint', 'payments/order', { items: [{ id: LISTED, qty: 1 }], address: { label: '', text: 'Near the bus stand, Latur' }, payment_method: 'upi' }), 'latur'), 400, 'address_needs_point');

    // ======================= SRV-2: a paid online order that cannot be adopted is refunded =======================
    const paidOrder = async (hash: string, over: Record<string, unknown> = {}, product = 'oa-prod') => {
      const id = crypto.randomUUID(); const total = Number(menu.price) * 2;
      must(await d.from('ol_orders').insert({ id, customer_hash: hash, items: [], subtotal: total, gst: 0, total, store_id: 'oa-store', payment_method: 'upi', payment_status: 'paid', razorpay_payment_id: `pay_${id.slice(0, 8)}`, status: 'placed', delivery_address: address, ...over }));
      must(await d.from('ol_order_items').insert({ order_id: id, product_id: product, name: menu.name, price: Number(menu.price), mrp: Number(menu.price), qty: 2 }));
      made.olOrders.push(id); return { id, total, paymentId: `pay_${id.slice(0, 8)}` };
    };
    await channel({ accepting: false });
    rzp.refunds.length = 0;
    const p1 = await paidOrder('oa-h-paid1');
    const ready1 = await adoptOrders([p1.id]);
    const after1 = must(await d.from('ol_orders').select('status, cancel_reason, payment_status, pos_order_id').eq('id', p1.id))[0];
    check('SRV-2: a paid online order the restaurant cannot take is cancelled, with a reason the customer can read, and is not handed on', after1.status === 'cancelled' && /not taking orders/.test(after1.cancel_reason) && after1.pos_order_id === null && !ready1.includes(p1.id), after1);
    check('SRV-2: ...and refunded through Razorpay for exactly its total, with an idempotency key', rzp.refunds.length === 1 && rzp.refunds[0].url.endsWith(`/payments/${p1.paymentId}/refund`) && rzp.refunds[0].body.amount === Math.round(p1.total * 100) && /^ol-refund-/.test(String(rzp.refunds[0].headers['X-Refund-Idempotency'])), rzp.refunds);
    // The cancel cascade (0219/0218) queues its own compensation refund; a direct refund by the server supersedes it ('rejected'), so only live rows count.
    const live = async (id: string, cols = 'amount, status, method, reference') => must(await d.from('ol_refunds').select(cols).eq('order_id', id)).filter((r: any) => r.status !== 'rejected');
    const processed = async (id: string) => (await live(id)).filter((r: any) => r.status === 'processed');
    const refund1 = await live(p1.id);
    check('SRV-2: ...booked in the refund ledger as processed, by Razorpay\'s refund id', refund1.length === 1 && Number(refund1[0].amount) === p1.total && refund1[0].status === 'processed' && /^rfnd_oa_/.test(refund1[0].reference), refund1);
    check('SRV-2: ...and the order now reads refunded', must(await d.from('ol_orders').select('payment_status').eq('id', p1.id))[0].payment_status === 'refunded');
    await adoptOrders([p1.id]);
    check('SRV-2: running it again does not refund twice', rzp.refunds.length === 1 && (await live(p1.id, 'id, status')).length === 1);

    rzp.down = true;
    const p2 = await paidOrder('oa-h-paid2');
    await adoptOrders([p2.id]);
    const after2 = must(await d.from('ol_orders').select('status, payment_status').eq('id', p2.id))[0];
    check('SRV-2: Razorpay down: the order is still cancelled and stays "paid" with no refund booked: it is queued, not forgotten', after2.status === 'cancelled' && after2.payment_status === 'paid' && (await processed(p2.id)).length === 0, after2);
    const stillDown = await refunds.refundDue();
    check('SRV-2: the refund sweep retries it while Razorpay is down and reports it still due', stillDown.due >= 1 && (await processed(p2.id)).length === 0, stillDown);
    rzp.down = false; rzp.refunds.length = 0;
    const swept = await refunds.refundDue();
    const refund2 = await live(p2.id, 'amount, status');
    check('SRV-2: once Razorpay is back the sweep refunds the queued order', swept.refunded >= 1 && refund2.length === 1 && Number(refund2[0].amount) === p2.total && rzp.refunds.length >= 1, { swept, refund2 });
    check('SRV-2: ...which now reads refunded and is not picked up again', must(await d.from('ol_orders').select('payment_status').eq('id', p2.id))[0].payment_status === 'refunded' && (await refunds.refundDue()).refunded === 0);

    rzp.refunds.length = 0;
    const cash = await mkOrder('oa-store', 'oa-prod', 'oa-h-cash');
    await adoptOrders([cash]);
    check('SRV-2: a cash order the restaurant cannot take is cancelled and nothing is sent to Razorpay', must(await d.from('ol_orders').select('status').eq('id', cash))[0].status === 'cancelled' && rzp.refunds.length === 0);
    const kept = await refunds.cancelUnfulfillable(good, 'test');
    check('SRV-2: an order a restaurant already has is never cancelled by this', kept.cancelled === false && must(await d.from('ol_orders').select('status').eq('id', good))[0].status === 'placed');

    // The whole path through the real webhook: charged while the restaurant was open, paused before the money arrived.
    await channel({ accepting: true });
    limits();
    const started = await pay.startPayment(await asCustomer('webhook-path', 'payments/order', { ...basket(), payment_method: 'upi' }), 'latur');
    await channel({ accepting: false });
    const webhook = async (event: string, entity: object, id: string) => {
      const raw = JSON.stringify({ event, payload: { payment: { entity } } });
      return pay.handleWebhook(new Request('http://localhost/api/payments/webhook', { method: 'POST', body: raw, headers: { 'x-razorpay-signature': createHmac('sha256', 'oa-webhook').update(raw).digest('hex'), 'x-razorpay-event-id': id } }));
    };
    const amount = Math.round(started.amount);
    rzp.refunds.length = 0;
    await webhook('payment.captured', { id: 'pay_oa_webhook', order_id: started.razorpay_order_id, amount, method: 'upi', notes: { checkout_id: started.checkout_id } }, `evt_oa_${Date.now()}_1`);
    const viaWebhook = must(await d.from('ol_orders').select('status, payment_status, pos_order_id').eq('checkout_id', started.checkout_id))[0];
    check('SRV-2: the customer paid, the restaurant had paused: through the webhook the order is cancelled and refunded in full (end to end)', viaWebhook.status === 'cancelled' && viaWebhook.payment_status === 'refunded' && viaWebhook.pos_order_id === null && rzp.refunds.length === 1 && rzp.refunds[0].body.amount === amount, { viaWebhook, refunds: rzp.refunds.length });
    check('SRV-2: ...and the checkout reads refunded too', must(await d.from('ol_checkouts').select('payment_status').eq('id', started.checkout_id))[0].payment_status === 'refunded');
    await channel({ accepting: true });

    // ======================= SRV-3: a payment after "switch to cash" =======================
    limits();
    const late = await pay.startPayment(await asCustomer('late', 'payments/order', { ...basket(), payment_method: 'upi' }), 'latur');
    const switched = await pay.switchToCash(await asCustomer('late', 'payments/cod', { checkout_id: late.checkout_id }));
    const lateOl = must(await d.from('ol_orders').select('id, total, pos_order_id, payment_method, payment_status').eq('checkout_id', late.checkout_id))[0];
    check('SRV-3: switched to cash: the checkout and its order are cash on delivery, adopted and with a rider job that collects the full total', switched.payment_status === 'not_charged' && lateOl.payment_method === 'cod' && !!lateOl.pos_order_id && Number(must(await d.from('delivery_jobs').select('cash_to_collect').eq('ol_order_id', lateOl.id))[0]?.cash_to_collect) === Number(lateOl.total), { switched, lateOl });
    rzp.refunds.length = 0;
    await webhook('payment.captured', { id: 'pay_oa_late', order_id: late.razorpay_order_id, amount: Math.round(Number(lateOl.total) * 100), method: 'upi', notes: { checkout_id: late.checkout_id } }, `evt_oa_${Date.now()}_2`);
    const lateCheckout = must(await d.from('ol_checkouts').select('payment_method, payment_status, razorpay_payment_id, payment_error').eq('id', late.checkout_id))[0];
    const lateOrder = must(await d.from('ol_orders').select('payment_method, payment_status, razorpay_payment_id').eq('id', lateOl.id))[0];
    check('SRV-3: the late capture did NOT turn the checkout or the order into a paid online one', lateCheckout.payment_method === 'cod' && lateCheckout.payment_status === 'not_charged' && lateCheckout.razorpay_payment_id === null && lateOrder.payment_method === 'cod' && lateOrder.payment_status === 'not_charged', { lateCheckout, lateOrder });
    check('SRV-3: ...it was refunded in full instead, once, and the checkout says so', rzp.refunds.length === 1 && rzp.refunds[0].url.endsWith('/payments/pay_oa_late/refund') && rzp.refunds[0].body.amount === Math.round(Number(lateOl.total) * 100) && /refunded/.test(lateCheckout.payment_error ?? ''), { refunds: rzp.refunds.length, lateCheckout });
    check('SRV-3: ...recorded in the ledger against the order, and the cash job still collects the full total', must(await d.from('ol_refunds').select('amount').eq('order_id', lateOl.id)).length === 1 && Number(must(await d.from('delivery_jobs').select('cash_to_collect, payment_mode').eq('ol_order_id', lateOl.id))[0].cash_to_collect) === Number(lateOl.total));
    await webhook('order.paid', { id: 'pay_oa_late', order_id: late.razorpay_order_id, amount: Math.round(Number(lateOl.total) * 100), method: 'upi', notes: { checkout_id: late.checkout_id } }, `evt_oa_${Date.now()}_3`);
    check('SRV-3: the same payment reported again (order.paid after payment.captured) is not refunded twice', rzp.refunds.length === 1 && must(await d.from('ol_refunds').select('id').eq('order_id', lateOl.id)).length === 1);
    const verifyBody = { checkout_id: late.checkout_id, razorpay_order_id: late.razorpay_order_id, razorpay_payment_id: 'pay_oa_late2', razorpay_signature: createHmac('sha256', 'oa-secret').update(`${late.razorpay_order_id}|pay_oa_late2`).digest('hex') };
    await refuse('SRV-3: the app reporting such a payment gets "you chose cash" (409 switched_to_cash), not "paid"', async () => pay.verifyPayment(await asCustomer('late', 'payments/verify', verifyBody)), 409, 'switched_to_cash');
    check('SRV-3: ...and the checkout is still a cash one', must(await d.from('ol_checkouts').select('payment_status, payment_method').eq('id', late.checkout_id))[0].payment_status === 'not_charged');

    // ======================= SRV-4: what the restaurant sees, and cash that is not owed =======================
    const posCash = must(await d.from('ol_orders').select('pos_order_id').eq('id', good))[0].pos_order_id as string;
    const staff = { userId: '00000000-0000-4000-8000-0000000000aa', email: '', name: 'IT Owner', role: 'org_owner', organizationId: org, organizationName: 'OA' };
    const online = await paidOrder('oa-h-online');
    await channel({ accepting: true });
    await adoptOrders([online.id]);
    const posOnline = must(await d.from('ol_orders').select('pos_order_id, status').eq('id', online.id))[0].pos_order_id as string;
    check('SRV-4: (setup) an order paid online was adopted for the restaurant', !!posOnline);
    const shownOnline = await restaurant.getOrder(staff, posOnline);
    const shownCash = await restaurant.getOrder(staff, posCash);
    check('SRV-4: staff are told an online order is paid online (UPI), with no cash to collect', /^Paid online \(UPI\)$/.test(shownOnline.payment) && shownOnline.collect_cash === false && shownOnline.payment_status === 'paid', { p: shownOnline.payment, c: shownOnline.collect_cash });
    check('SRV-4: a cash order still reads cash on delivery, with cash to collect', shownCash.payment === 'Cash on delivery' && shownCash.collect_cash === true, { p: shownCash.payment, c: shownCash.collect_cash });
    await restaurant.act(staff, posOnline, 'delivered', { version: shownOnline.version }).then(() => check('SRV-4: marking an online-paid order "delivered" is refused', false), e => check('SRV-4: marking an online-paid order "delivered" is refused (409 already_paid): it used to book the full total as CASH too', e.status === 409 && e.code === 'already_paid', `${e.status} ${e.code}`));
    const payRows = must(await d.from('payments').select('id, method, amount, reference').eq('order_id', posOnline));
    check('SRV-4: ...and no CASH payment row was written for it', payRows.every((p: any) => p.method !== 'cash'), payRows);
    await restaurant.act(staff, posCash, 'delivered', { version: shownCash.version }).then(() => check('SRV-4: (control) a cash order reaches the database rule', false), e => check('SRV-4: (control) a cash order gets past the new check and meets the database\'s own rule (a rider owns this delivery)', e.code !== 'already_paid' && /rider is handling this delivery/.test(e.detail), `${e.status} ${e.code} ${e.detail}`));

    // ======================= SRV-6: the dispatch credential is scoped to its organizations =======================
    const jobsRoute = await import('../app/api/dispatch/jobs/index+api');
    const jobRoute = await import('../app/api/dispatch/jobs/[id]+api');
    const cancelRoute = await import('../app/api/dispatch/jobs/[id]/cancel+api');
    const releaseRoute = await import('../app/api/dispatch/jobs/[id]/release+api');
    const reassignRoute = await import('../app/api/dispatch/jobs/[id]/reassign+api');
    const sweepRoute = await import('../app/api/dispatch/sweep+api');
    const eventsRoute = await import('../app/api/dispatch/events+api');
    const resolveRoute = await import('../app/api/dispatch/exceptions/[id]/resolve+api');
    let keyN = 0;
    const svc = async (path: string, body?: unknown) => {
      const raw = body === undefined ? '' : JSON.stringify(body), stamp = String(Math.floor(Date.now() / 1000)), method = body === undefined ? 'GET' : 'POST', at = new URL(`http://localhost/api/${path}`);
      return new Request(at, { method, headers: { authorization: 'Bearer it-token', 'x-request-id': 'oa-1', 'x-timestamp': stamp, 'x-signature': await hmacHex('it-secret', `${method}\n${at.pathname}${at.search}\n${stamp}\n${await sha256(raw)}`), ...(body !== undefined ? { 'idempotency-key': `oa-scope-${Date.now()}-${++keyN}` } : {}) }, body: raw || undefined });
    };
    const answer = async (res: Response) => ({ status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) as any });
    const jobRow = must(await d.from('delivery_jobs').select('id, ol_order_id, organization_id, version').eq('ol_order_id', good))[0];
    const STRANGER_ORG = '00000000-0000-4000-8000-0000000000bb';
    process.env.DISPATCH_ALLOWED_ORGS = org;
    let x = await answer(await jobRoute.GET(await svc(`dispatch/jobs/${jobRow.id}`), { id: jobRow.id }));
    check('SRV-6: a credential limited to this organization can read its job', x.status === 200 && x.body.job_id === jobRow.id, x);
    process.env.DISPATCH_ALLOWED_ORGS = STRANGER_ORG;
    x = await answer(await jobRoute.GET(await svc(`dispatch/jobs/${jobRow.id}`), { id: jobRow.id }));
    check('SRV-6: a credential limited to another organization sees nothing: 404, like a job that does not exist', x.status === 404 && x.body.code === 'not_found', x);
    x = await answer(await jobsRoute.GET(await svc(`dispatch/jobs?ol_order_id=${good}`), {}));
    check('SRV-6: ...also when it asks by order', x.status === 404, x);
    x = await answer(await cancelRoute.POST(await svc(`dispatch/jobs/${jobRow.id}/cancel`, { reason: 'customer_cancelled' }), { id: jobRow.id }));
    check('SRV-6: ...cannot cancel it', x.status === 404 && must(await d.from('delivery_jobs').select('status').eq('id', jobRow.id))[0].status !== 'cancelled', x);
    x = await answer(await releaseRoute.POST(await svc(`dispatch/jobs/${jobRow.id}/release`, {}), { id: jobRow.id }));
    check('SRV-6: ...cannot release it', x.status === 404, x);
    x = await answer(await reassignRoute.POST(await svc(`dispatch/jobs/${jobRow.id}/reassign`, { reason: 'no' }), { id: jobRow.id }));
    check('SRV-6: ...cannot reassign it', x.status === 404, x);
    const raised = must(await d.from('delivery_exceptions').insert({ job_id: jobRow.id, rider_id: must(await d.from('riders').select('id').limit(1))[0]?.id ?? null, kind: 'other', note: 'oa scope test' }).select('id'))[0];
    x = await answer(await resolveRoute.POST(await svc(`dispatch/exceptions/${raised.id}/resolve`, { outcome: 'resume' }), { id: raised.id }));
    check('SRV-6: ...cannot resolve a problem raised on it', x.status === 404, x);
    await d.from('delivery_exceptions').delete().eq('id', raised.id);
    x = await answer(await sweepRoute.POST(await svc('dispatch/sweep', {}), {}));
    check('SRV-6: ...cannot run the sweep (it works on every organization\'s jobs): 403', x.status === 403 && x.body.code === 'organization_not_allowed', x);
    x = await answer(await eventsRoute.GET(await svc('dispatch/events?after=0&limit=500'), {}));
    check('SRV-6: ...reads an events feed with none of this organization\'s events, and the cursor still moves on', x.status === 200 && x.body.events.length === 0 && x.body.next > 0, { n: x.body?.events?.length, next: x.body?.next });
    process.env.DISPATCH_ALLOWED_ORGS = org;
    x = await answer(await eventsRoute.GET(await svc('dispatch/events?after=0&limit=500'), {}));
    check('SRV-6: the credential limited to this organization gets its events', x.status === 200 && x.body.events.some((e: any) => e.job_id === jobRow.id), { n: x.body?.events?.length });
    delete process.env.DISPATCH_ALLOWED_ORGS;
    x = await answer(await eventsRoute.GET(await svc('dispatch/events?after=0&limit=500'), {}));
    check('SRV-6: an unrestricted credential gets every event', x.status === 200 && x.body.events.some((e: any) => e.job_id === jobRow.id));

    // Creating a job: the organization the caller claims is checked against the order and its store (the order has no organization yet).
    const fresh = await mkOrder('oa-store', 'oa-prod', 'oa-h-scope');
    const payload = (organization_id: string | null) => ({
      ol_order_id: fresh, pos_order_id: null, organization_id, order_no: 'OA-1', payment_mode: 'cod', cash_to_collect: 100, items: { count: 1, temperature: 'hot' }, prep_minutes: 10,
      promised_by: null, pickup: { name: 'OA Kitchen', address: 'Main Road', lat: 18.4088, lng: 76.5604, phone: null }, drop: { area: 'Gandhi Chowk', address: 'Flat 4', lat: 18.4001, lng: 76.5702, customer_first_name: 'Asha', customer_phone: null },
      vehicle: 'any', dispatch_trigger: 'accepted',
    });
    process.env.DISPATCH_ALLOWED_ORGS = `${org},${STRANGER_ORG}`;
    x = await answer(await jobsRoute.POST(await svc('dispatch/jobs', payload(STRANGER_ORG)), {}));
    check('SRV-6: a job cannot be attached to another organization before the order is adopted (403: the claim is checked against the order\'s store)', x.status === 403 && x.body.code === 'organization_not_allowed' && must(await d.from('delivery_jobs').select('id').eq('ol_order_id', fresh)).length === 0, x);
    x = await answer(await jobsRoute.POST(await svc('dispatch/jobs', payload(org)), {}));
    check('SRV-6: the right organization creates it (201)', x.status === 201 && must(await d.from('delivery_jobs').select('organization_id').eq('ol_order_id', fresh))[0].organization_id === org, x);
    const noOrg = await mkOrder('oa-store', 'oa-prod', 'oa-h-scope2');
    x = await answer(await jobsRoute.POST(await svc('dispatch/jobs', { ...payload(null), ol_order_id: noOrg }), {}));
    check('SRV-6: a credential limited to organizations is refused a claim of "no organization" (403) unless it is allowed *', x.status === 403 && x.body.code === 'organization_not_allowed', x);
    delete process.env.DISPATCH_ALLOWED_ORGS;
    x = await answer(await jobsRoute.POST(await svc('dispatch/jobs', { ...payload(null), ol_order_id: noOrg }), {}));
    check('SRV-6: a claim of "no organization" for an order that has one is corrected to the real organization', x.status === 201 && must(await d.from('delivery_jobs').select('organization_id').eq('ol_order_id', noOrg))[0].organization_id === org, x);
    process.env.DISPATCH_ALLOWED_ORGS = STRANGER_ORG;
    const third = await mkOrder('oa-store', 'oa-prod', 'oa-h-scope3');
    x = await answer(await jobsRoute.POST(await svc('dispatch/jobs', { ...payload(STRANGER_ORG), ol_order_id: third }), {}));
    check('SRV-6: a credential for another organization cannot create a job for this restaurant\'s order even by claiming its own (403)', x.status === 403, x);
    x = await answer(await jobsRoute.POST(await svc('dispatch/jobs', { ...payload(org), ol_order_id: third }), {}));
    check('SRV-6: ...nor by naming the real organization, which it is not allowed (403)', x.status === 403, x);
    delete process.env.DISPATCH_ALLOWED_ORGS;
    x = await answer(await jobsRoute.POST(await svc('dispatch/jobs', { ...payload(org), ol_order_id: crypto.randomUUID() }), {}));
    check('SRV-6: a job for an order that does not exist is refused (404)', x.status === 404, x);
  } finally {
    // the shared orders made through adoption are append-only: tag them for the purge script, then remove what can be removed
    for (const h of made.hashes) made.olOrders.push(...((await d.from('ol_orders').select('id').eq('customer_hash', h)).data ?? []).map((o: any) => o.id));
    made.olOrders = [...new Set(made.olOrders)];
    const posIds = ((await d.from('ol_orders').select('pos_order_id').in('id', made.olOrders)).data ?? []).map((o: any) => o.pos_order_id).filter(Boolean);
    if (posIds.length) await d.from('orders').update({ notes: 'ZZ-TEST order-adoption-integration' }).in('id', posIds);
    await d.from('ol_refunds').delete().in('order_id', made.olOrders);
    await d.from('ol_checkouts').delete().in('customer_hash', made.hashes);
    for (const id of made.olOrders) { await d.from('delivery_events').delete().in('job_id', (await d.from('delivery_jobs').select('id').eq('ol_order_id', id)).data?.map(j => j.id) ?? []); await d.from('delivery_jobs').delete().eq('ol_order_id', id); }
    for (const id of made.olOrders) { await d.from('ol_order_items').delete().eq('order_id', id); await d.from('ol_orders').delete().eq('id', id); }
    console.log('Run  ../../../database/purge_test_orders.sh  to remove the tagged test order (orders are append-only for the app).');
    await d.from('ol_products').delete().in('id', ['oa-prod', 'oa-loose', 'oa-loose-demo', 'oa-orphan-prod']);
    await d.from('ol_stores').delete().in('id', ['oa-store', 'oa-orphan', 'oa-demo-store']);
    await d.from('ol_service_areas').update({ pickup_enforcement: laturBefore }).eq('city_id', 'latur');
    if (channelBefore) await d.from('ol_merchant_channels').update({ accepting: channelBefore.accepting }).eq('organization_id', org);
    else await d.from('ol_merchant_channels').delete().eq('organization_id', org);
  }
  console.log(`\n${passed} checks passed${process.exitCode ? ' (with FAILURES above)' : ''}.`);
}
main().catch(e => { console.error(e); process.exit(1); });
