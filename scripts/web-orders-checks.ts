// Web orders (spec-part2-live-orders contract A; database: partner migration 0660) through the RUNNING customer server, against the LOCAL
// Supabase only: CORS and its preflight, the device key, the Idempotency-Key, the request shape, a dine-in order from a real table QR session
// (Niks Cafe), its replay, a key reused for another order, a pickup order in an offered slot, status by tracking link and by order id with the
// same device, the bill refused until every dish is ready and then given, and errors the guest page can act on.
// The restaurant's side (accept, kitchen ready) is played with the service key: order_transition 'restaurant_accept' (fires the KOT) and the
// dishes marked ready, as the kitchen screen would. Orders it makes are tagged ZZ-TEST and cancelled at the end (orders are append-only).
// Niks Cafe's opening hours are switched off for the run (closed at night would refuse every order) and put back afterwards.
// Needs: the local stack, agent/demo/niks_cafe_local.sql + agent/demo/niks_cafe_one_local_link.sql, and the server on WEB_BASE
// (default http://localhost:8099, launch config one-local-web-localdb).
//   Run from frontend/:  npx tsx scripts/web-orders-checks.ts
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(`${process.cwd()}/.env.local`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }
const SUPA = process.env.SUPABASE_URL ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(SUPA)) throw new Error('refusing to run: not a local database');
const BASE = process.env.WEB_BASE ?? 'http://localhost:8099';
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(BASE)) throw new Error('refusing to run: the server is not local');
const ORG = 'bd4d8ee9-5885-41e4-b6a1-ba2b9cb873dd';
const ORIGIN = 'http://localhost:8090'; // the POS server's guest web app in development

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('ok   ', what); } else { process.exitCode = 1; console.error('FAIL ', what, JSON.stringify(detail ?? '').slice(0, 500)); }
};

type Res = { status: number; body: any; headers: Headers };
async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* an HTML error page */ }
  return { status: r.status, body: parsed, headers: r.headers };
}

async function main() {
  const d = createClient(SUPA, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } });
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
  const device = `zz${randomBytes(16).toString('hex')}`, other = `zz${randomBytes(16).toString('hex')}`;
  const tag = randomBytes(3).toString('hex');
  const made: string[] = [];

  const hours = must(await d.from('org_listing_profiles').select('open_days, weekly_hours').eq('organization_id', ORG).single());
  must(await d.from('org_listing_profiles').update({ open_days: null, weekly_hours: null }).eq('organization_id', ORG));
  try {
    const dishes = must(await d.from('menu_items').select('id, name, price').eq('organization_id', ORG).eq('is_available', true).order('price').limit(2));
    const table = must(await d.from('dining_tables').select('id, label, qr_token').eq('organization_id', ORG).eq('is_active', true).eq('qr_enabled', true).not('qr_token', 'is', null).order('label').limit(1).single());
    const session = must(await d.rpc('guest_qr_open', { p: { code: table.qr_token } })).session as string;
    const slots = must(await d.rpc('gx_preorder_slots', { p: { slug: 'niks-cafe' } }));
    const slot = slots?.days?.[0]?.slots?.[0] as string;
    check('setup: two dishes, a table session, a pickup slot', dishes.length === 2 && /^[0-9a-f]{64}$/.test(session) && !!slot);

    // --- CORS
    const pre = await fetch(`${BASE}/api/web/orders`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, x-customer-key, idempotency-key' } });
    check('preflight: 204, the guest page origin, the device key and Idempotency-Key headers allowed',
      pre.status === 204 && pre.headers.get('access-control-allow-origin') === ORIGIN && /x-customer-key/.test(pre.headers.get('access-control-allow-headers') ?? '')
      && /idempotency-key/.test(pre.headers.get('access-control-allow-headers') ?? ''), pre.status);
    const evil = await post('/api/web/orders/status', { track: '0'.repeat(36) }, { origin: 'http://localhost.evil.example' });
    check('another website is refused', evil.status === 403 || evil.status === 500, evil.status); // the Expo dev server refuses foreign origins itself (500)

    const dine = (key: string, over: Record<string, unknown> = {}, dev = device) => post('/api/web/orders', {
      store_link: 'niks-cafe', mode: 'dine_in', table_session: session, guest_name: 'ZZ-TEST web checks',
      lines: [{ menu_item_id: dishes[0].id, qty: 2, notes: 'ZZ-TEST' }], ...over,
    }, { 'x-customer-key': dev, 'idempotency-key': key });

    // --- the request itself
    // the probes below each use a fresh device: placing is limited to 6 a minute per device (and per network address)
    const probe = () => `zz${randomBytes(16).toString('hex')}`;
    check('no Idempotency-Key: 400', (await post('/api/web/orders', {}, { 'x-customer-key': probe() })).status === 400);
    check('no device key: 400 device_key_required', (await post('/api/web/orders', {}, { 'idempotency-key': `zz-web-${tag}-0` })).body?.code === 'device_key_required');
    const priced = await dine(`zz-web-${tag}-p`, { lines: [{ menu_item_id: dishes[0].id, qty: 1, unit_price: 1 }] }, probe());
    check('a price in the body is refused (the server prices)', priced.status === 400 && priced.body?.code === 'invalid_request', priced.body);
    const noTable = await post('/api/web/orders', { store_link: 'niks-cafe', mode: 'dine_in', lines: [{ menu_item_id: dishes[0].id, qty: 1 }] }, { 'x-customer-key': probe(), 'idempotency-key': `zz-web-${tag}-t` });
    check('dine-in without a table session: 400', noTable.status === 400, noTable.body);
    const badSession = await dine(`zz-web-${tag}-s`, { table_session: 'ab'.repeat(32) }, probe());
    check('an unknown table session: 409 session_expired', badSession.status === 409 && badSession.body?.code === 'session_expired', badSession.body);
    const notLive = await dine(`zz-web-${tag}-n`, { store_link: 'no-such-place' }, probe());
    check('an unknown restaurant page: 404', notLive.status === 404, notLive.body);

    // --- place, replay, reuse
    const first = await dine(`zz-web-${tag}-1`);
    if (first.body?.order_id) made.push(first.body.order_id);
    check(`dine-in placed: ${first.body?.display_no} table ${first.body?.table_label}, stage ${first.body?.stage}`,
      first.status === 200 && first.body.stage === 'waiting_partner' && first.body.stage_label === 'Sent' && first.body.mode === 'dine_in'
      && first.body.table_label === table.label && /^[0-9a-f]{36}$/.test(first.body.track) && first.body.replayed === false, first.body);
    check('CORS header on the answer', first.headers.get('access-control-allow-origin') === ORIGIN);
    const again = await dine(`zz-web-${tag}-1`);
    check('same key again: the same order, replayed, no new tracking link', again.status === 200 && again.body.order_id === first.body.order_id && again.body.replayed === true && again.body.track === null, again.body);
    const reused = await dine(`zz-web-${tag}-1`, { lines: [{ menu_item_id: dishes[0].id, qty: 3 }] });
    check('same key, another order: 422 idempotency_mismatch', reused.status === 422 && reused.body?.code === 'idempotency_mismatch', reused.body);

    const pickup = await post('/api/web/orders', { store_link: 'niks-cafe', mode: 'pickup', pickup_at: slot, phone: '98765 43210', guest_name: 'ZZ-TEST pickup',
      lines: [{ menu_item_id: dishes[1].id, qty: 1 }] }, { 'x-customer-key': device, 'idempotency-key': `zz-web-${tag}-2` });
    if (pickup.body?.order_id) made.push(pickup.body.order_id);
    check(`pickup placed: ${pickup.body?.display_no} at ${pickup.body?.pickup_at}`, pickup.status === 200 && pickup.body.mode === 'pickup' && pickup.body.table_label === null
      && Date.parse(pickup.body.pickup_at) === Date.parse(slot), pickup.body);
    const noPhone = await post('/api/web/orders', { store_link: 'niks-cafe', mode: 'pickup', pickup_at: slot, lines: [{ menu_item_id: dishes[1].id, qty: 1 }] },
      { 'x-customer-key': device, 'idempotency-key': `zz-web-${tag}-3` });
    check('pickup without a phone: 400', noPhone.status === 400, noPhone.body);

    const flood: number[] = [];
    const flooder = probe();
    for (let i = 0; i < 7; i++) flood.push((await post('/api/web/orders', {}, { 'x-customer-key': flooder, 'idempotency-key': `zz-web-${tag}-f${i}` })).status);
    check('placing is limited per device: the 7th call in a minute is 429', flood[6] === 429 && flood.slice(0, 6).every(c => c === 400), flood);

    // --- status
    const track = first.body.track as string, id = first.body.order_id as string;
    const st = async () => (await post('/api/web/orders/status', { track })).body;
    check('status by tracking link: waiting for the restaurant', (await st()).stage === 'waiting_partner');
    check('status by order id with the same device', (await post('/api/web/orders/status', { order_id: id }, { 'x-customer-key': device })).body?.stage === 'waiting_partner');
    check('another device cannot read it: 404', (await post('/api/web/orders/status', { order_id: id }, { 'x-customer-key': other })).status === 404);
    check('a made-up tracking link: 404', (await post('/api/web/orders/status', { track: 'f'.repeat(36) })).status === 404);
    check('a bad body: 400', (await post('/api/web/orders/status', { track: 'x' })).status === 400);
    const early = await post('/api/web/orders/bill', { track });
    check('bill before the restaurant accepts: 409 bill_not_yet', early.status === 409 && early.body?.code === 'bill_not_yet', early.body);

    // --- the restaurant accepts (KOT fires), the kitchen marks the dishes ready
    must(await d.rpc('order_transition', { p_order: id, p_event: 'restaurant_accept', p_actor: 'system', p_idempotency_key: `zz-web-accept-${tag}`, p_meta: {} }));
    const pos = must(await d.from('ol_orders').select('pos_order_id').eq('id', id).single()).pos_order_id as string;
    const kots = must(await d.from('kot_tickets').select('id').eq('order_id', pos));
    const accepted = await st();
    check(`accepted: KOT fired, stage ${accepted.stage}`, kots.length >= 1 && accepted.stage === 'accepted' && accepted.can_request_bill === false, accepted);
    const cooking = await post('/api/web/orders/bill', { track });
    check('bill while the kitchen cooks: 409', cooking.status === 409, cooking.body);
    must(await d.from('order_items').update({ status: 'ready' }).eq('order_id', pos));
    const ready = await st();
    check('ready: the bill can be asked for', ready.stage === 'ready' && ready.can_request_bill === true, ready);
    const bill = await post('/api/web/orders/bill', { track });
    check(`bill: stage bill_ready, total ${bill.body?.bill?.total}`, bill.status === 200 && bill.body.stage === 'bill_ready' && bill.body.bill?.lines?.length === 1
      && bill.body.bill.total > 0 && bill.body.already === false, bill.body);
    const posStatus = must(await d.from('orders').select('status').eq('id', pos).single()).status;
    check('the POS order waits for payment', posStatus === 'awaiting_payment', posStatus);
    check('asking again answers the same bill', (await post('/api/web/orders/bill', { track })).body?.already === true);
  } finally {
    for (const id of made) {
      const r = await d.rpc('order_transition', { p_order: id, p_event: 'ops_cancel', p_actor: 'system', p_idempotency_key: `zz-web-cancel-${id}`,
        p_meta: { cancel_reason: 'ZZ-TEST web order checks', cancel_code: 'ops_cancelled' } });
      if (r.error) console.warn('could not cancel', id, r.error.message);
    }
    await d.from('org_listing_profiles').update({ open_days: hours.open_days, weekly_hours: hours.weekly_hours }).eq('organization_id', ORG);
  }
  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
