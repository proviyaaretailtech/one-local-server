// End to end, against the LOCAL stack only (database 0580, spec specs/order-accept-kot): customer order -> restaurant accept -> kitchen
// ticket -> customer, through the real server code (Guard 2 before charging, the bridge with its push, the tracking stage), the real
// database functions as the signed-in staff member would call them (heartbeat, accept, kitchen display), real Supabase Realtime (private
// topics, as the customer, the staff member and a second customer who must hear nothing), pg_cron (timeout and ghost watchers) and the
// Edge Function ghost-order-refunder (pg_cron -> function -> Cashfree). Only Cashfree and Expo push are stand-ins.
//
// Needs: the local Supabase stack; `supabase functions serve --env-file <file>` in OL-ui with CASHFREE_BASE_URL pointing at a Cashfree
// stand-in on CF_STUB (default http://127.0.0.1:48123); the Vault secrets edge_functions_url / edge_service_role_key set locally.
// Creates a tagged test restaurant (ZZ-TEST 580 e2e) and test users each run. Orders are append-only: they are tagged ZZ-TEST (POS notes,
// customer hash) so database/purge_test_orders.sh can remove them with their ledgers afterwards.
//   Run from frontend/:  npx tsx scripts/order-accept-kot-e2e.ts
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

for (const line of readFileSync(`${process.cwd()}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
const URL_ = process.env.SUPABASE_URL ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(URL_)) throw new Error('refusing to run: not a local database');
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const CF_STUB = process.env.CF_STUB ?? 'http://127.0.0.1:48123';
if (!SERVICE || !ANON) throw new Error('the local service and anon keys are needed in .env.localdb.off');

let passed = 0, failed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('ok   ', what); } else { failed++; process.exitCode = 1; console.error('FAIL ', what, JSON.stringify(detail ?? '').slice(0, 400)); }
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(what: () => Promise<T | null | undefined | false>, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) { const v = await what(); if (v) return v; if (Date.now() > end) return null; await sleep(500); }
}

// Expo push, simulated (the rest of fetch is real)
const pushes: { title: string; body: string; ttl: number }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://exp.host/')) { const msgs = JSON.parse(init.body); pushes.push(...msgs); return Response.json({ data: msgs.map(() => ({ status: 'ok' })) }); }
  return realFetch(input, init);
}) as typeof fetch;

type Heard = { topic: string; event: string; payload: any };
function listen(client: SupabaseClient, topic: string, events: string[], heard: Heard[]) {
  return new Promise<string>(resolve => {
    let ch = client.channel(topic, { config: { private: true } });
    for (const e of events) ch = ch.on('broadcast', { event: e }, (m: any) => heard.push({ topic, event: e, payload: m.payload }));
    ch.subscribe((status: string) => { if (status !== 'CLOSED') resolve(status); });
    setTimeout(() => resolve('TIMED_OUT'), 10_000);
  });
}

async function main() {
  const { db } = await import('../server/db');
  const { adoptOrders, assertFulfillable } = await import('../server/dispatch');
  const d = db();
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
  const tag = randomBytes(3).toString('hex');
  const org = randomUUID(), menuItem = randomUUID(), store = `zz-e2e-${tag}`, product = `zz-e2e-prod-${tag}`;

  // ------------------------------------------------------------- a test restaurant, a manager, two customers (local test users)
  const pw = () => randomBytes(18).toString('base64url');
  const mk = async (email: string) => { const password = pw(); const u = must(await d.auth.admin.createUser({ email, password, email_confirm: true })); return { id: u.user.id as string, email, password }; };
  const mgr = await mk(`zz-e2e-mgr-${tag}@example.test`), custA = await mk(`zz-e2e-a-${tag}@example.test`), custB = await mk(`zz-e2e-b-${tag}@example.test`);
  must(await d.from('organizations').insert({ id: org, name: `ZZ-TEST 580 e2e ${tag}`, slug: `zz-e2e-${tag}`, type: 'franchise', business_domain: 'Restaurant', control_status: 'Approved' }));
  const role = must(await d.from('roles').select('id').eq('slug', 'manager').single()).id;
  must(await d.from('org_users').insert({ organization_id: org, user_id: mgr.id, role_id: role, email: mgr.email, full_name: 'ZZ Manager', status: 'active' }));
  must(await d.from('menu_items').insert({ id: menuItem, organization_id: org, name: 'ZZ Cold Coffee', price: 120 }));
  must(await d.from('ol_merchant_channels').insert({ organization_id: org, accepting: true, address: 'Main Road, Latur', lat: 18.4088, lng: 76.5604 }));
  // the manager confirms the pickup pin on the map, through the real function (the rider collects from this point)
  must(await d.rpc('ol_set_pickup_location', { p_org: org, p_actor: mgr.id, p_lat: 18.4088, p_lng: 76.5604, p_address: 'Main Road, Latur', p_place_id: null, p_source: 'map_pin', p_accuracy_m: 8, p_confirm: true, p_request_key: `zz-e2e-pin-${tag}`, p_expected_version: null }));
  must(await d.from('ol_stores').insert({ id: store, name: 'ZZ e2e cafe', organization_id: org, is_demo: false }));
  must(await d.from('ol_products').insert({ id: product, name: 'ZZ Cold Coffee', price: 120, mrp: 120, department: 'food', store_id: store, menu_item_id: menuItem }));
  must(await d.from('ol_partner_devices').insert({ organization_id: org, user_id: mgr.id, platform: 'android', expo_push_token: `ExponentPushToken[zz-e2e-${tag}]` }));

  const signIn = async (u: { email: string; password: string }) => {
    const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
    if (error) throw error;
    await c.realtime.setAuth(data.session!.access_token);
    return c;
  };
  const staff = await signIn(mgr), a = await signIn(custA), b = await signIn(custB);
  const groups = (items: string[]) => [{ store_id: store, store_name: 'ZZ e2e cafe', items: items.map(id => ({ id })) }];
  const point = { lat: 18.40, lng: 76.57 };

  // ------------------------------------------------------------- Guard 2 and the heartbeat
  let refused = '';
  try { await assertFulfillable(groups([product]), point, true); } catch (e: any) { refused = String(e?.detail ?? e?.message ?? e); }
  check('Guard 2: before any heartbeat the checkout is refused, nothing charged ("offline")', /offline/.test(refused) && /Nothing was charged/.test(refused), refused);
  const beat = must(await staff.rpc('pos_heartbeat', { p: { device: 'e2e tablet' } }));
  check('heartbeat as the signed-in manager: the restaurant is live', beat?.allow_order === true && beat?.organization_id === org, beat);
  let allowed = true;
  try { await assertFulfillable(groups([product]), point, true); } catch { allowed = false; }
  check('Guard 2: with a fresh heartbeat the same checkout passes', allowed);

  // ------------------------------------------------------------- realtime listeners
  const heard: Heard[] = [], heardB: Heard[] = [];
  const mkOrder = async (opts: { paid?: boolean } = {}) => {
    const id = randomUUID();
    let checkout: string | null = null;
    if (opts.paid) {
      checkout = randomUUID();
      must(await d.from('ol_checkouts').insert({ id: checkout, customer_hash: `ZZ-TEST-e2e-${tag}`, user_id: custA.id, kind: 'food', item_total: 240, total: 252, payment_method: 'upi', payment_status: 'paid', payment_provider: 'cashfree', provider_order_id: `cf_zz_${tag}_${id.slice(0, 6)}` }));
    }
    must(await d.from('ol_orders').insert({ id, customer_hash: `ZZ-TEST-e2e-${tag}`, user_id: custA.id, items: [], subtotal: 240, gst: 12, total: 252, store_id: store, status: 'placed',
      payment_method: opts.paid ? 'upi' : 'cod', payment_status: opts.paid ? 'paid' : 'not_charged', checkout_id: checkout, delivery_address: { text: 'ZZ-TEST, Latur', ...point }, city_id: 'latur' }));
    must(await d.from('ol_order_items').insert({ order_id: id, product_id: product, name: 'ZZ Cold Coffee', price: 120, mrp: 120, qty: 2 }));
    return id;
  };
  // the bridge, then the POS order gets the ZZ-TEST tag (database/purge_test_orders.sh removes tagged orders and their ledgers)
  const adopt = async (id: string) => {
    await adoptOrders([id]);
    const pos = must(await d.from('ol_orders').select('pos_order_id').eq('id', id).single()).pos_order_id as string | null;
    if (pos) await d.from('orders').update({ notes: 'ZZ-TEST 580 e2e' }).eq('id', pos);
    return pos;
  };
  const o1 = await mkOrder();
  const subs = await Promise.all([
    listen(a, `ol-order:${o1}`, ['stage'], heard),
    listen(staff, `org:${org}:orders`, ['order_waiting', 'order_accepted', 'order_cancelled', 'order_packed'], heard),
    listen(staff, `org:${org}:kitchen`, ['kot_created', 'kot_updated'], heard),
    listen(b, `ol-order:${o1}`, ['stage'], heardB),        // customer B on A's order: must hear nothing
    listen(b, `org:${org}:orders`, ['order_waiting'], heardB), // and nothing from the restaurant
  ]);
  check('realtime: the customer and the staff member are let into their own topics', subs[0] === 'SUBSCRIBED' && subs[1] === 'SUBSCRIBED' && subs[2] === 'SUBSCRIBED', subs);
  check('realtime: another customer is refused on A\'s order and on the restaurant', subs[3] !== 'SUBSCRIBED' && subs[4] !== 'SUBSCRIBED', subs.slice(3));
  // A rogue customer tries to push a fake "delivered" into A's order, over the socket and over the REST broadcast door.
  const fake = { stage: 'delivered', fake: tag };
  const viaSocket = b.channel(`ol-order:${o1}`, { config: { private: true } });
  const sent = await viaSocket.send({ type: 'broadcast', event: 'stage', payload: fake }).catch(() => 'error');
  const rest = await realFetch(`${URL_}/realtime/v1/api/broadcast`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${(await b.auth.getSession()).data.session!.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic: `ol-order:${o1}`, event: 'stage', payload: fake, private: true }] }),
  });
  await sleep(3000);
  check('realtime: a fake message from another customer never reaches A (socket and REST)',
    !heard.some(h => h.payload?.fake === tag), { socketSend: sent, restStatus: rest.status, heardFake: heard.filter(h => h.payload?.fake === tag) });

  // ------------------------------------------------------------- the bridge: sent to the restaurant
  pushes.length = 0;
  const pos1 = (await adopt(o1)) as string;
  check('bridge: one POS order, and the restaurant push says 4 minutes and lives 240 s', !!pos1 && pushes.length === 1 && /4 minutes/.test(pushes[0].body) && pushes[0].ttl === 240, pushes);
  await until(async () => heard.find(h => h.event === 'order_waiting'), 8000);
  await until(async () => heard.find(h => h.topic === `ol-order:${o1}` && h.payload?.stage === 'waiting_partner'), 8000);
  check('realtime: the partner inbox rang (order_waiting) and the customer heard "waiting for the restaurant"',
    heard.some(h => h.event === 'order_waiting' && h.payload?.order_id === pos1) && heard.some(h => h.topic === `ol-order:${o1}` && h.payload?.stage === 'waiting_partner'));

  // ------------------------------------------------------------- accept (new partner app path: the gateway function, as the manager)
  const version = must(await d.from('orders').select('updated_at').eq('id', pos1).single()).updated_at;
  const acc = await staff.rpc('gw_online_order_act', { p: { order_id: pos1, action: 'accept', prep_minutes: 15, version } });
  check('accept as the manager: accepted', !acc.error && acc.data?.online?.status === 'accepted', acc.error ?? acc.data?.online);
  const kot = await until(async () => heard.find(h => h.event === 'kot_created' && h.payload?.order_id === pos1), 8000);
  const custKot = await until(async () => heard.find(h => h.topic === `ol-order:${o1}` && h.payload?.stage === 'kitchen_ticket_created'), 8000);
  check('kitchen: the ticket was broadcast to the kitchen display with its number', !!kot && kot.payload.kot_no != null, kot);
  check('customer: told "accepted" only with the kitchen ticket number (kitchen_ticket_created), never a bare "accepted"',
    !!custKot && custKot.payload.kot_no === kot?.payload.kot_no && !heard.some(h => h.topic === `ol-order:${o1}` && h.payload?.stage === 'accepted'), custKot);
  const again = await staff.rpc('gw_online_order_act', { p: { order_id: pos1, action: 'accept', prep_minutes: 15, version } });
  const tickets = must(await d.from('kot_tickets').select('id').eq('order_id', pos1));
  check('double tap on accept (old version): no error, still exactly one kitchen ticket', !again.error && tickets.length === 1, again.error ?? tickets);

  // ------------------------------------------------------------- the kitchen display, as the manager
  const queue = must(await staff.rpc('kds_queue', { p: {} }));
  const card = (queue?.tickets ?? []).find((t: any) => t.order_id === pos1 || t.display_no === kot?.payload.display_no);
  check('kitchen display: the accepted order is on the queue', !!card, (queue?.tickets ?? []).length);
  if (card) {
    const st = await staff.rpc('kds_ticket_act', { p: { ticket_id: card.id, station: card.station, action: 'start', expected_version: card.version } });
    check('kitchen: start', !st.error, st.error);
    await until(async () => heard.find(h => h.topic === `ol-order:${o1}` && h.payload?.stage === 'preparing'), 8000);
    check('customer: heard "the kitchen has started"', heard.some(h => h.topic === `ol-order:${o1}` && h.payload?.stage === 'preparing'));
    const q2 = must(await staff.rpc('kds_queue', { p: {} }));
    const c2 = (q2?.tickets ?? []).find((t: any) => t.id === card.id);
    const rd = await staff.rpc('kds_ticket_act', { p: { ticket_id: card.id, station: c2?.station ?? card.station, action: 'ready', expected_version: c2?.version } });
    check('kitchen: ready', !rd.error, rd.error);
    await until(async () => heard.find(h => h.topic === `ol-order:${o1}` && h.payload?.stage === 'ready'), 8000);
    const st1 = must(await d.from('ol_orders').select('status').eq('id', o1).single()).status;
    check('kitchen ready reached the customer: order packed, customer heard "ready"', st1 === 'packed' && heard.some(h => h.topic === `ol-order:${o1}` && h.payload?.stage === 'ready'), st1);
  }
  const stage1 = must(await d.rpc('ol_order_stage', { p_ol: o1 }));
  check('tracking stage (what GET /orders/:id/tracking returns): ready with the ticket number', stage1?.stage === 'ready' && stage1?.kot_no === kot?.payload.kot_no, stage1);

  // ------------------------------------------------------------- reject
  const o2 = await mkOrder();
  const sub2 = await listen(a, `ol-order:${o2}`, ['stage'], heard);
  const pos2 = (await adopt(o2)) as string;
  const v2 = must(await d.from('orders').select('updated_at').eq('id', pos2).single()).updated_at;
  const rej = await staff.rpc('gw_online_order_act', { p: { order_id: pos2, action: 'reject', reason: 'Out of milk', version: v2 } });
  const heardRej = await until(async () => heard.find(h => h.topic === `ol-order:${o2}` && h.payload?.stage === 'rejected_by_partner'), 8000);
  check('reject: the customer heard rejected_by_partner with the reason, nothing to refund on cash',
    sub2 === 'SUBSCRIBED' && !rej.error && !!heardRej && /Out of milk/.test(heardRej.payload.cancel_reason) && heardRej.payload.refund === 'none', rej.error ?? heardRej);

  // ------------------------------------------------------------- 240 s timeout (the deadline is moved, pg_cron does the rest)
  const o3 = await mkOrder();
  await listen(a, `ol-order:${o3}`, ['stage'], heard);
  await adopt(o3);
  const dl = must(await d.from('ol_orders').select('restaurant_deadline, sent_to_restaurant_at').eq('id', o3).single());
  check('timeout: the restaurant has 240 s', Math.abs((Date.parse(dl.restaurant_deadline) - Date.parse(dl.sent_to_restaurant_at)) / 1000 - 240) < 2, dl);
  must(await d.from('ol_orders').update({ restaurant_deadline: new Date(Date.now() - 1000).toISOString() }).eq('id', o3));
  const heardTo = await until(async () => heard.find(h => h.topic === `ol-order:${o3}` && h.payload?.stage === 'auto_cancelled'), 25_000);
  check('timeout: pg_cron order-timeout-watcher cancelled it within ~10 s and the customer heard auto_cancelled', !!heardTo, heard.filter(h => h.topic === `ol-order:${o3}`));

  // ------------------------------------------------------------- ghost restaurant, paid online: cancelled, refunded through the Edge Function
  const o4 = await mkOrder({ paid: true });
  await listen(a, `ol-order:${o4}`, ['stage'], heard);
  await adopt(o4);
  const stubBefore = await (await realFetch(`${CF_STUB}/__log`)).json().catch(() => []) as unknown[];
  must(await d.rpc('ol_restaurant_live', { p_org: org }));
  // the restaurant's devices go silent: the heartbeat is 10 minutes old
  const { error: hbErr } = await d.from('ol_pos_heartbeats').update({ last_at: new Date(Date.now() - 600_000).toISOString() }).eq('organization_id', org);
  check('(setup) the heartbeat can be aged by the service role', !hbErr, hbErr);
  const heardGhost = await until(async () => heard.find(h => h.topic === `ol-order:${o4}` && h.payload?.stage === 'auto_cancelled_ghost'), 45_000);
  check('ghost: pg_cron ghost-order-watcher cancelled the paid order and the customer heard "went offline, refund started"',
    !!heardGhost && heardGhost.payload.refund === 'initiated', heardGhost ?? heard.filter(h => h.topic === `ol-order:${o4}`));
  const refunded = await until(async () => {
    const r = must(await d.from('ol_refunds').select('id, status, provider, provider_refund_id').eq('order_id', o4));
    return r.length === 1 && r[0].status === 'gateway_pending' && r[0].provider_refund_id ? r[0] : null;
  }, 45_000);
  const stubAfter = await (await realFetch(`${CF_STUB}/__log`)).json().catch(() => []) as unknown[];
  check('ghost: pg_cron woke the Edge Function, which asked Cashfree for exactly one refund', !!refunded && stubAfter.length === stubBefore.length + 1, { refunded, calls: stubAfter.length - stubBefore.length });
  if (refunded) {
    // Cashfree's webhook says it settled (what the server's webhook does): the order is refunded and the customer hears it
    must(await d.rpc('ol_refund_provider_update', { p_refund: refunded.id, p_provider: 'cashfree', p_merchant_ref: null, p_provider_refund_id: refunded.provider_refund_id, p_provider_status: 'SUCCESS', p_source: 'webhook', p_detail: null }));
    const done = await until(async () => heard.find(h => h.topic === `ol-order:${o4}` && h.payload?.refund === 'processed'), 10_000);
    check('refund settled: the customer heard "refund sent"', !!done, heard.filter(h => h.topic === `ol-order:${o4}`).map(h => h.payload?.refund));
  }
  let ghostRefused = '';
  try { await assertFulfillable(groups([product]), point, true); } catch (e: any) { ghostRefused = String(e?.detail ?? e?.message ?? e); }
  check('Guard 2: the silent restaurant takes no new order', /offline/.test(ghostRefused), ghostRefused);

  check('customer B heard nothing at all from A\'s order or the restaurant', heardB.length === 0, heardB);
  await Promise.all([a, b, staff].map(c => c.removeAllChannels()));
  console.log(`\n${passed} passed, ${failed} failed  (test restaurant ${org}; orders are tagged ZZ-TEST and stay: append-only)`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
