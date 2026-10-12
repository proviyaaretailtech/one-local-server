// SINGLE-ORDER THREAD (derived from golden-thread.ts): ONE order through the one demo organization, its owner and its rider. Leaves the rows in place. LOCAL ONLY.
// ORIGINAL GOLDEN THREAD: one run that proves the ecosystem works as one system on the LOCAL stack, with real components:
//   Master Admin backend (real process, real HTTP) -> organization -> owner + menu (real GoTrue sign-in, real PostgREST + RLS)
//   -> customer checkout rows -> adoptOrders/dispatchOrders -> restaurant accepts (real partner route, owner's real token)
//   -> rider offer/accept/steps/proof (real rider routes, rider's real token) -> money -> order_trace -> security spot checks.
// Only Expo push is simulated (nothing leaves the machine). Refuses anything but the local database. Never prints secrets.
// Needs the local Supabase stack, frontend/.env.localdb.off, and the Master Admin backend's own .env pointing at it.
// CLEAN-UP: the shared `orders` row is append-only for the app, so it is tagged notes = 'ZZ-TEST golden-thread'; afterwards run
//   /Users/lohit/agentic-os-coder/database/purge_test_orders.sh
// Run from frontend/:   npx tsx scripts/golden-thread.ts
import { readFileSync } from 'node:fs';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const ROOT = process.cwd();
const TAG = 'single-order-thread';
for (const line of readFileSync(`${ROOT}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):/;
if (!LOCAL.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');
Object.assign(process.env, { DISPATCH_SERVICE_TOKEN: 'gt-token', DISPATCH_SIGNING_SECRET: 'gt-secret' });

const SB = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!;
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const secret = () => randomBytes(18).toString('base64url') + 'aA1!';
const results: string[] = [];
const pushes: any[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://exp.host/')) { const msgs = JSON.parse(init.body); pushes.push(...msgs); return Response.json({ data: msgs.map(() => ({ status: 'ok' })) }); }
  return realFetch(input, init);
}) as typeof fetch;

class StepFailure extends Error {}
const must = (r: { data: any; error: any }, what = 'db'): any => { if (r.error) throw new StepFailure(`${what}: ${JSON.stringify(r.error)}`); return r.data; };
const assert = (cond: unknown, msg: string, detail?: unknown) => { if (!cond) throw new StepFailure(`${msg}${detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 600)}`); };

async function http(base: string, method: string, path: string, opts: { token?: string; apikey?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await realFetch(base + path, { method, headers: { 'content-type': 'application/json', ...(opts.apikey ? { apikey: opts.apikey } : {}), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text(); let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
const rest = (token: string | undefined, method: string, path: string, body?: unknown, prefer = 'return=representation') =>
  http(`${SB}/rest/v1`, method, path, { token, apikey: ANON, body, headers: prefer ? { prefer } : {} });
async function signIn(email: string, password: string): Promise<string> {
  const r = await http(SB, 'POST', '/auth/v1/token?grant_type=password', { apikey: ANON, body: { email, password } });
  assert(r.status === 200 && r.json?.access_token, `sign-in failed for ${email}`, { status: r.status });
  return r.json.access_token;
}

let master: ChildProcess | null = null;
const residue: string[] = [];
const made = { authUsers: [] as string[], orgs: [] as string[], olOrders: [] as string[], checkouts: [] as string[], posOrders: [] as string[], riders: [] as string[], rateCard: null as string | null, adminUser: null as string | null };

async function main() {
  const { db } = await import('../server/db');
  const dispatch = await import('../server/dispatch');
  const partnerDevices = await import('../app/api/partner/devices+api');
  const partnerAccept = await import('../app/api/partner/orders/[id]/accept+api');
  const riderPush = await import('../app/api/rider/push-token+api');
  const riderAvail = await import('../app/api/rider/availability+api');
  const offerCurrent = await import('../app/api/rider/offers/current+api');
  const offerAccept = await import('../app/api/rider/offers/[id]/accept+api');
  const jobStep = await import('../app/api/rider/jobs/[id]/step+api');
  const jobVerify = await import('../app/api/rider/jobs/[id]/pickup/verify+api');
  const jobProof = await import('../app/api/rider/jobs/[id]/proof+api');
  const d = db();
  const now = () => new Date().toISOString();

  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); results.push(name); console.log(`ok  ${name}`); }
    catch (e: any) { console.error(`FAIL ${name}\n     ${e instanceof StepFailure ? e.message : (e?.stack ?? e)}`); throw new StepFailure(`stopped at: ${name}`); }
  };
  const makeUser = async (label: string) => {
    const email = `golden.${label}.${RUN}@proviyaa.test`, password = secret();
    const { data, error } = await d.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new StepFailure(`createUser ${label}: ${error?.message}`);
    made.authUsers.push(data.user.id);
    return { id: data.user.id, email, password };
  };
  const roleId = async (slug: string) => must(await d.from('roles').select('id').eq('slug', slug).single(), 'roles').id as string;

  const ctx: any = {};
  try {
    await step('1-2 Existing org Demo Spice, owner and rider sign in (real GoTrue); menu mapped to One Local products', async () => {
      const pw = readFileSync('/Users/lohit/agentic-os-coder/agent/dev-credentials.md', 'utf8').match(/password: (\S+)/)![1];
      const org = must(await d.from('organizations').select('id,control_status').eq('slug', 'demo-spice').single(), 'org');
      assert(org.control_status === 'Active', 'org is Active', org);
      ctx.org = org.id;
      ctx.location = must(await d.from('locations').select('id').eq('organization_id', ctx.org).eq('code', 'MAIN').single(), 'location').id;
      ctx.ownerToken = await signIn('owner@demo.proviyaa.test', pw);
      ctx.riderToken = await signIn('rider@demo.proviyaa.test', pw);
      ctx.rider = { id: must(await d.from('riders').select('user_id').eq('full_name', 'Demo Rider').single()).user_id };
      const menu = must(await d.from('menu_items').select('id,name,price').eq('organization_id', ctx.org).in('name', ['Paneer Butter Masala', 'Butter Naan']), 'menu');
      assert(menu.length === 2, 'two menu items exist', menu);
      ctx.store = 'demo-spice';
      ctx.prod = menu.map((m: any) => ({ id: `demo-spice-${m.id}`, menu: m }));
      must(await d.from('ol_products').upsert(ctx.prod.map((p: any) => ({ id: p.id, name: p.menu.name, price: Number(p.menu.price), mrp: Number(p.menu.price), department: 'food', store_id: ctx.store, menu_item_id: p.menu.id, city_id: 'latur', is_demo: false }))), 'ol_products');
      must(await d.from('ol_merchant_channels').update({ accepting: true, store_id: ctx.store, city_id: 'latur', address: 'Gandhi Chowk, Latur', lat: 18.4088, lng: 76.5604 }).eq('organization_id', ctx.org), 'channel');
    });

    // ---------- rider + restaurant device prepared before the order (a rider must be online for the offer) ----------
    const asUser = (token: string, method = 'GET', body?: unknown, key?: string) => new Request('http://localhost/api/x', { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

    // ---------- 3. Customer order ----------
    await step('3 Customer COD order -> adoptOrders + dispatchOrders: shared order, restaurant push once, job waiting', async () => {
      // the restaurant's phone registers for alerts (real partner route, owner's real token)
      let r = await partnerDevices.PUT(asUser(ctx.ownerToken, 'PUT', { token: `ExponentPushToken[gt-owner-${RUN}]`, platform: 'android' }), {});
      assert(r.status === 200, 'owner registers the Partner device', await r.json());
      // the order, written the way server/store.ts createCheckout writes it
      const lines = [{ p: ctx.prod[0], qty: 1 }, { p: ctx.prod[1], qty: 2 }];
      const items = lines.map(l => ({ id: l.p.id, name: l.p.menu.name, weight: '', image: '', price: Number(l.p.menu.price), mrp: Number(l.p.menu.price), qty: l.qty }));
      const subtotal = items.reduce((n, i) => n + i.price * i.qty, 0);
      ctx.total = subtotal;
      const checkoutId = crypto.randomUUID(), olId = crypto.randomUUID();
      const addr = { label: 'Home', text: 'Flat 4, Gandhi Chowk, Latur', area: 'Gandhi Chowk', lat: 18.4001, lng: 76.5702, notes: 'Ring twice' };
      must(await d.from('ol_checkouts').insert({ id: checkoutId, customer_hash: `single-${RUN}`, kind: 'food', item_total: subtotal, discount: 0, delivery_fee: 0, total: subtotal, payment_method: 'cod', payment_status: 'not_charged', city_id: 'latur', created_at: now() }), 'ol_checkouts');
      made.checkouts.push(checkoutId);
      must(await d.from('ol_orders').insert({ id: olId, customer_hash: `single-${RUN}`, items, subtotal, discount: 0, delivery_fee: 0, gst: 0, total: subtotal, payment_method: 'cod', payment_status: 'not_charged', status: 'placed', eta_minutes: 30, delivery_address: addr, city_id: 'latur', checkout_id: checkoutId, store_id: ctx.store, created_at: now() }), 'ol_orders');
      made.olOrders.push(olId); ctx.ol = olId;
      must(await d.from('ol_order_items').insert(items.map(i => ({ order_id: olId, product_id: i.id, name: i.name, weight: i.weight, image: i.image, price: i.price, mrp: i.mrp, qty: i.qty }))), 'ol_order_items');
      pushes.length = 0;
      await dispatch.adoptOrders([olId]);
      await dispatch.dispatchOrders([olId]);
      const ol = must(await d.from('ol_orders').select('pos_order_id,organization_id').eq('id', olId).single());
      assert(ol.pos_order_id && ol.organization_id === ctx.org, 'the consumer order was adopted into the shared orders table', ol);
      ctx.pos = ol.pos_order_id; made.posOrders.push(ctx.pos);
      must(await d.from('orders').update({ notes: TAG }).eq('id', ctx.pos), 'tag order');
      const pos = must(await d.from('orders').select('channel,status,organization_id,location_id,total').eq('id', ctx.pos).single());
      assert(pos.channel === 'online' && pos.status === 'new' && pos.organization_id === ctx.org && pos.location_id === ctx.location, 'shared order: online, status new, this org, MAIN location', pos);
      assert(Number(pos.total) === ctx.total, 'shared order total equals the cart total', { pos: pos.total, expect: ctx.total });
      const oi = must(await d.from('order_items').select('qty').eq('order_id', ctx.pos));
      assert(oi.length === 2 && oi.reduce((n: number, i: any) => n + i.qty, 0) === 3, 'shared order has the 2 lines (3 pieces)', oi);
      assert(pushes.filter(p => p.data?.type === 'new_order').length === 1, 'restaurant pushed exactly once', pushes);
      const job = must(await d.from('delivery_jobs').select('*').eq('ol_order_id', olId).single());
      assert(job.pos_order_id === ctx.pos && job.dispatch_trigger === 'accepted' && job.released_at === null, 'delivery job waits for the restaurant (trigger accepted, not released)', job);
      ctx.job = job.id;
    });

    // ---------- 4. Restaurant accepts ----------
    await step('4 Restaurant accepts via the real partner route: kitchen, job released, rider offered', async () => {
      // rider provisioned and online near the store, so the release can offer the job
      ctx.riderId = must(await d.from('riders').select('id').eq('user_id', ctx.rider.id).single(), 'rider').id;
      must(await d.from('rider_availability').upsert({ rider_id: ctx.riderId, online: true, lat: 18.4100, lng: 76.5604, last_seen_at: now() }), 'rider_availability');
      let res = await riderPush.PUT(asUser(ctx.riderToken, 'PUT', { expo_push_token: `ExponentPushToken[gt-rider-${RUN}]`, platform: 'android' }), {});
      assert(res.status === 200, 'rider registers a push token', await res.json());
      res = await riderAvail.POST(asUser(ctx.riderToken, 'POST', { online: true, lat: 18.41, lng: 76.5604 }), {});
      assert(res.status === 200, 'rider goes online in the service area', await res.json());
      if (!must(await d.from('rider_rate_cards').select('id').eq('city_id', 'latur').eq('active', true)).length) must(await d.from('rider_rate_cards').insert({ city_id: 'latur', base_minor: 2000, per_km_minor: 500, min_minor: 3000, active: true }), 'rate card');

      const version = must(await d.from('orders').select('updated_at').eq('id', ctx.pos).single()).updated_at as string;
      pushes.length = 0;
      res = await partnerAccept.POST(asUser(ctx.ownerToken, 'POST', { version, prep_minutes: 15 }), { id: ctx.pos });
      const body = await res.json();
      assert(res.status === 200, 'partner accept answered 200', { status: res.status, body });
      const pos = must(await d.from('orders').select('status').eq('id', ctx.pos).single());
      assert(pos.status === 'sent_to_kitchen', 'orders.status is sent_to_kitchen', pos);
      const kot = must(await d.from('kot_tickets').select('id,status').eq('order_id', ctx.pos));
      assert(kot.length >= 1, 'a kitchen ticket exists', kot);
      const job = must(await d.from('delivery_jobs').select('status,released_at,version').eq('id', ctx.job).single());
      assert(job.released_at !== null, 'the job was released', job);
      const asg = must(await d.from('delivery_assignments').select('rider_id,outcome').eq('job_id', ctx.job));
      assert(asg.length === 1 && asg[0].rider_id === ctx.riderId && asg[0].outcome === null, 'a live rider offer was made to our rider', { asg, job });
      assert(pushes.some(p => p.data?.type === 'job_offer'), 'the rider was pushed the offer', pushes);
    });

    // ---------- 5. Rider delivery ----------
    await step('5 Rider delivers: offer, accept, pickup, drop, OTP proof with cash; states and payment verified', async () => {
      const T = ctx.riderToken; let n = 0;
      const rcall = async (handler: any, params: any, body?: unknown, method = 'POST') => {
        const res = await handler(asUser(T, method, body, method === 'POST' && handler !== offerAccept.POST ? `gt-${RUN}-${++n}` : undefined), params);
        const text = res.status === 204 ? '' : await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : null };
      };
      let r = await rcall(offerCurrent.GET, {}, undefined, 'GET');
      assert(r.status === 200 && r.body.job?.id === ctx.job, 'offers/current shows our job', r.body);
      r = await rcall(offerAccept.POST, { id: r.body.offer_id });
      assert(r.status === 200 && r.body.state === 'accepted', 'accept: job accepted', r.body);
      let v = r.body.version as number;
      const jobRow = must(await d.from('delivery_jobs').select('order_no,status,rider_id').eq('id', ctx.job).single());
      assert(jobRow.status === 'assigned' && jobRow.rider_id === ctx.riderId, 'job assigned to our rider', jobRow);
      const move = async (to: string, extra: any = {}) => {
        const x = await rcall(jobStep.POST, { id: ctx.job }, { to, version: v, lat: to.includes('drop') || to === 'handover' ? 18.4001 : 18.4088, lng: to.includes('drop') || to === 'handover' ? 76.5702 : 76.5604, accuracy_m: 8, ...extra });
        assert(x.status === 200 && x.body.state === to, `step ${to}`, x.body); v = x.body.version; return x.body;
      };
      await move('to_pickup'); await move('at_pickup');
      const items = must(await d.from('ol_order_items').select('id').eq('order_id', ctx.ol)) as { id: string }[];
      r = await rcall(jobVerify.POST, { id: ctx.job }, { method: 'typed', code: jobRow.order_no, items: items.map(i => ({ id: i.id, ok: true })), version: v });
      assert(r.status === 200 && r.body.result === 'verified' && r.body.job.state === 'pickup_verified', 'pickup verified with the order number', r.body);
      v = r.body.job.version;
      await move('picked_up');
      assert(must(await d.from('ol_orders').select('status').eq('id', ctx.ol).single()).status === 'out', 'ol_orders.status is out after pickup', must(await d.from('ol_orders').select('status').eq('id', ctx.ol).single()));
      assert(must(await d.from('delivery_jobs').select('status').eq('id', ctx.job).single()).status === 'picked_up', 'job status picked_up');
      await move('to_drop'); await move('at_drop'); await move('handover');
      const code = await dispatch.deliveryOtp(ctx.ol);
      r = await rcall(jobProof.POST, { id: ctx.job }, { method: 'otp', code, version: v, lat: 18.4001, lng: 76.5702, cash_collected: ctx.total });
      assert(r.status === 200 && r.body.status === 'delivered' && r.body.cash_collected === ctx.total, 'proof with OTP and exact cash: delivered', r.body);
      const j = must(await d.from('delivery_jobs').select('status,delivered_at').eq('id', ctx.job).single());
      assert(j.status === 'delivered' && j.delivered_at, 'job delivered in the database', j);
      const ol = must(await d.from('ol_orders').select('status,payment_status').eq('id', ctx.ol).single());
      assert(ol.status === 'delivered', 'ol_orders.status delivered', ol);
      const pos = must(await d.from('orders').select('status,paid_at').eq('id', ctx.pos).single());
      assert(pos.status === 'delivered', 'orders.status delivered', pos);
      assert(ol.payment_status === 'paid' && pos.paid_at, 'payment is paid on the consumer order and the shared order (paid_at set)', { pos, ol });
      const pay = must(await d.from('payments').select('method,amount').eq('order_id', ctx.pos));
      assert(pay.length === 1 && pay[0].method === 'cash' && Number(pay[0].amount) === ctx.total, 'exactly one cash payment for the total', pay);
    });

    // ---------- 6. Money + trace ----------
    await step('6 Money and trace: one cash entry, one delivery fee, order_trace complete for service + owner, other tenant blind', async () => {
      const cash = must(await d.from('rider_cash_entries').select('kind,amount_minor').eq('delivery_job_id', ctx.job));
      assert(cash.length === 1 && Number(cash[0].amount_minor) === ctx.total * 100, 'rider_cash_entries has the COD collection once', cash);
      const earn = must(await d.from('rider_earnings').select('kind,amount_minor').eq('delivery_job_id', ctx.job));
      const fee = earn.filter((e: any) => e.kind === 'delivery_fee');
      assert(fee.length === 1 && Number(fee[0].amount_minor) > 0, 'exactly one delivery_fee earning', earn);
      const need = (t: any, who: string) => {
        assert(t.order?.id === ctx.pos, `${who}: trace has the order`, Object.keys(t));
        assert(t.organization?.id === ctx.org, `${who}: trace has the organization`);
        assert(t.location?.id === ctx.location, `${who}: trace has the location`);
        assert(t.items?.length === 2, `${who}: trace has items`, t.items);
        assert(t.payments?.length === 1, `${who}: trace has payments`, t.payments);
        assert(t.kitchen_tickets?.length >= 1, `${who}: trace has kitchen tickets`);
        assert(t.order_events?.length >= 1, `${who}: trace has order_events`);
        assert(t.consumer_orders?.length === 1, `${who}: trace has the consumer order`);
        assert(t.delivery_jobs?.length === 1, `${who}: trace has the delivery job`);
        assert(t.assignments?.length >= 1, `${who}: trace has assignments`);
        assert(t.rider_earnings?.length >= 1, `${who}: trace has rider earnings`, t.rider_earnings);
        assert(Number(t.audit_entries) > 0, `${who}: trace has audit entries`, t.audit_entries);
      };
      need(must(await d.rpc('order_trace', { p_order: ctx.pos }), 'order_trace svc'), 'service role');
      const ow = await rest(ctx.ownerToken, 'POST', '/rpc/order_trace', { p_order: ctx.pos }, '');
      assert(ow.status === 200, 'owner calls order_trace over PostgREST', ow);
      need(ow.json, 'owner');
    });

  } finally {
    await cleanup(d);
  }
}

async function cleanup(_d: any) { console.log('\n-- rows left in place on purpose (single-order dataset) --'); }

const finish = (failed: boolean) => {
  console.log(`\nSingle-order thread: ${results.length}/5 steps passed${failed ? ' (STOPPED at first failure)' : ''}.`);
  if (residue.length) { console.log('Left behind (expected until the purge, or needs a look):'); residue.forEach(r => console.log('  - ' + r)); }
  console.log('(purge not needed) /Users/lohit/agentic-os-coder/database/purge_test_orders.sh   (removes the ZZ-TEST golden-thread order, its job, KOT, payment, events).');
  console.log('After the purge the org, rider, rider earnings/cash rows, admin user golden.admin@proviyaa.test and the Master Admin platform_admins row remain as residue.');
  process.exit(failed ? 1 : 0);
};
main().then(() => finish(false)).catch(e => { if (!(e instanceof StepFailure)) console.error(e); finish(true); });
