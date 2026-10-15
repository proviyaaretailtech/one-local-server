// GOLDEN THREAD: one run that proves the ecosystem works as one system on the LOCAL stack, with real components:
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
const MASTER_DIR = '/Users/lohit/agentic-os-coder/Master Admin /backend';
const MASTER_PORT = '5098';
const MASTER = `http://127.0.0.1:${MASTER_PORT}/api`;
const TAG = 'ZZ-TEST golden-thread';
for (const line of readFileSync(`${ROOT}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):/;
if (!LOCAL.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');
const masterEnv = readFileSync(`${MASTER_DIR}/.env`, 'utf8');
const masterVal = (k: string) => masterEnv.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
if (!LOCAL.test(masterVal('SUPABASE_URL')) || !/@(127\.0\.0\.1|localhost):/.test(masterVal('DATABASE_URL'))) throw new Error('refusing to run: Master Admin .env is not pointed at the local stack');
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
    // ---------- 1. Master Admin ----------
    await step('1 Master Admin: backend up, platform admin, login, organization created + Active, defaults exist', async () => {
      const adminEmail = 'golden.admin@proviyaa.test', adminPassword = secret();
      master = spawn('npm', ['run', 'dev'], { cwd: MASTER_DIR, env: { PATH: process.env.PATH!, HOME: process.env.HOME!, PORT: MASTER_PORT } as unknown as NodeJS.ProcessEnv, detached: true, stdio: 'ignore' });
      let up = false;
      for (let i = 0; i < 90 && !up; i++) { await new Promise(r => setTimeout(r, 1000)); try { up = (await realFetch(`${MASTER}/health`)).ok; } catch { /* still starting */ } }
      assert(up, `Master Admin did not answer ${MASTER}/health within 90s`);
      // re-runnable: a platform admin left by an earlier run keeps its old password, so reset it to this run's value first
      for (let page = 1; page <= 20; page++) {
        const { data: lu } = await d.auth.admin.listUsers({ page, perPage: 200 });
        const hit = lu?.users.find(u => u.email === adminEmail);
        if (hit) { const up = await d.auth.admin.updateUserById(hit.id, { password: adminPassword }); assert(!up.error, 'reset the leftover admin password'); break; }
        if (!lu?.users.length || lu.users.length < 200) break;
      }
      const boot = spawnSync('npm', ['run', 'bootstrap:admin'], { cwd: MASTER_DIR, env: { PATH: process.env.PATH!, HOME: process.env.HOME!, ADMIN_EMAIL: adminEmail, ADMIN_PASSWORD: adminPassword } as unknown as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 120_000 });
      assert(boot.status === 0, 'bootstrap:admin failed', (boot.stderr || boot.stdout || '').replace(adminPassword, '***').slice(-400));
      const login = await http(MASTER, 'POST', '/auth/login', { body: { email: adminEmail, password: adminPassword } });
      assert(login.status === 200 && login.json?.token, 'Master Admin login failed', { status: login.status, message: login.json?.message });
      const token = login.json.token as string;
      const mkOrg = async (label: string) => {
        const phone = '+91 9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
        const c = await http(MASTER, 'POST', '/organizations', { token, body: { business_name: `Golden ${label} ${RUN}`, domain: `golden-${label}-${RUN}.test`, email: `org.${label}.${RUN}@proviyaa.test`, phone_number: phone, status: 'Draft' } });
        assert(c.status === 201 && c.json?.organization?.id, `create organization ${label}`, { status: c.status, body: c.json });
        const id = c.json.organization.id as string; made.orgs.push(id);
        assert(c.json.organization.status === 'Draft', 'organization starts as Draft', c.json.organization);
        const u = await http(MASTER, 'PUT', `/organizations/${id}`, { token, body: { status: 'Active' } });
        assert(u.status === 200, `activate organization ${label}`, { status: u.status, body: u.json });
        return id;
      };
      ctx.org = await mkOrg('a'); ctx.orgB = await mkOrg('b');
      const org = must(await d.from('organizations').select('control_status').eq('id', ctx.org).single(), 'org');
      assert(org.control_status === 'Active', 'organization is Active', org);
      const loc = must(await d.from('locations').select('id,code').eq('organization_id', ctx.org), 'locations');
      assert(loc.length === 1 && loc[0].code === 'MAIN', 'default location MAIN exists', loc);
      ctx.location = loc[0].id;
      assert(must(await d.from('org_bill_settings').select('organization_id').eq('organization_id', ctx.org)).length === 1, 'org_bill_settings row exists');
      assert(must(await d.from('org_dispatch_settings').select('organization_id').eq('organization_id', ctx.org)).length === 1, 'org_dispatch_settings row exists');
      const ch = must(await d.from('ol_merchant_channels').select('accepting').eq('organization_id', ctx.org));
      assert(ch.length === 1 && ch[0].accepting === false, 'ol_merchant_channels exists and is closed', ch);
    });

    // ---------- 2. Owner + restaurant setup ----------
    await step('2 Owner signs in, adds 2 menu items under RLS; server opens channel, store, product mapping', async () => {
      const owner = await makeUser('owner'); const ownerB = await makeUser('ownerb');
      const ownerRole = await roleId('org_owner');
      must(await d.from('org_users').insert([
        { organization_id: ctx.org, user_id: owner.id, role_id: ownerRole, email: owner.email, full_name: 'Golden Owner', status: 'active' },
        { organization_id: ctx.orgB, user_id: ownerB.id, role_id: ownerRole, email: ownerB.email, full_name: 'Golden Owner B', status: 'active' },
      ]), 'org_users');
      ctx.owner = owner; ctx.ownerToken = await signIn(owner.email, owner.password); ctx.ownerBToken = await signIn(ownerB.email, ownerB.password);
      const ins = await rest(ctx.ownerToken, 'POST', '/menu_items', [
        { organization_id: ctx.org, name: `Golden Thali ${RUN}`, price: 120, is_available: true },
        { organization_id: ctx.org, name: `Golden Lassi ${RUN}`, price: 80, is_available: true },
      ]);
      assert(ins.status === 201 && ins.json?.length === 2, 'owner inserts 2 menu items over PostgREST', ins);
      ctx.menu = ins.json;
      const bIns = await rest(ctx.ownerBToken, 'POST', '/menu_items', { organization_id: ctx.org, name: 'leak', price: 1 });
      assert(bIns.status >= 400, "another organization's owner cannot insert menu items into this org", bIns);
      ctx.store = `gt-store-${RUN}`;
      must(await d.from('ol_stores').insert({ id: ctx.store, name: `Golden Kitchen ${RUN}`, organization_id: ctx.org, is_demo: false, city_id: 'latur' }), 'ol_stores');
      must(await d.from('ol_merchant_channels').update({ accepting: true, store_id: ctx.store, city_id: 'latur' }).eq('organization_id', ctx.org), 'channel');
      // The owner confirms the pickup point in the partner app (specs/restaurant-pickup-location); checkout trusts only a confirmed point.
      const pickup = await import('../app/api/partner/pickup-location/index+api');
      const pr: Response = await pickup.PUT(new Request('http://localhost/api/partner/pickup-location', { method: 'PUT', headers: { authorization: `Bearer ${ctx.ownerToken}`, 'content-type': 'application/json', 'idempotency-key': `gt-pickup-${RUN}` }, body: JSON.stringify({ lat: 18.4088, lng: 76.5604, formatted_address: 'Main Road, Latur', source: 'map_pin', confirm: true }) }), {});
      const pj = await pr.json();
      assert(pr.status === 200 && pj.status === 'verified', 'owner confirms the pickup point', pj);
      ctx.prod = ctx.menu.map((m: any, i: number) => ({ id: `gt-prod-${RUN}-${i}`, menu: m }));
      must(await d.from('ol_products').insert(ctx.prod.map((p: any) => ({ id: p.id, name: p.menu.name, price: Number(p.menu.price), mrp: Number(p.menu.price), department: 'food', store_id: ctx.store, menu_item_id: p.menu.id, city_id: 'latur', is_demo: false }))), 'ol_products');
      const ch = must(await d.from('ol_merchant_channels').select('accepting').eq('organization_id', ctx.org).single());
      assert(ch.accepting === true, 'channel is open');
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
      must(await d.from('ol_checkouts').insert({ id: checkoutId, customer_hash: `gt-${RUN}`, kind: 'food', item_total: subtotal, discount: 0, delivery_fee: 0, total: subtotal, payment_method: 'cod', payment_status: 'not_charged', city_id: 'latur', created_at: now() }), 'ol_checkouts');
      made.checkouts.push(checkoutId);
      must(await d.from('ol_orders').insert({ id: olId, customer_hash: `gt-${RUN}`, items, subtotal, discount: 0, delivery_fee: 0, gst: 0, total: subtotal, payment_method: 'cod', payment_status: 'not_charged', status: 'placed', eta_minutes: 30, delivery_address: addr, city_id: 'latur', checkout_id: checkoutId, store_id: ctx.store, created_at: now() }), 'ol_orders');
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
      const rider = await makeUser('rider'); ctx.rider = rider; ctx.riderToken = await signIn(rider.email, rider.password);
      const rr = must(await d.from('riders').insert({ user_id: rider.id, full_name: 'Golden Rider', type: 'solo', status: 'approved', vehicle: 'bike', city_id: 'latur', phone: '+91 9000000000' }).select('id'), 'riders');
      ctx.riderId = rr[0].id; made.riders.push(ctx.riderId);
      must(await d.from('rider_availability').upsert({ rider_id: ctx.riderId, online: true, lat: 18.4100, lng: 76.5604, last_seen_at: now() }), 'rider_availability');
      let res = await riderPush.PUT(asUser(ctx.riderToken, 'PUT', { expo_push_token: `ExponentPushToken[gt-rider-${RUN}]`, platform: 'android' }), {});
      assert(res.status === 200, 'rider registers a push token', await res.json());
      res = await riderAvail.POST(asUser(ctx.riderToken, 'POST', { online: true, lat: 18.41, lng: 76.5604 }), {});
      assert(res.status === 200, 'rider goes online in the service area', await res.json());
      // temporary rate card so the delivery earns a fee (removed at the end)
      const card = must(await d.from('rider_rate_cards').insert({ city_id: 'latur', base_minor: 2000, per_km_minor: 500, min_minor: 3000, active: true }).select('id'), 'rate card');
      made.rateCard = card[0].id;

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
      const other = await rest(ctx.ownerBToken, 'POST', '/rpc/order_trace', { p_order: ctx.pos }, '');
      assert(other.status === 200 && other.json?.order === null && Object.keys(other.json).length === 1, "a second organization's user gets order = null", other);
    });

    // ---------- 7. Security ----------
    await step('7 Security: owner cannot rewrite orders or insert payments, anon and other tenant see nothing', async () => {
      const before = must(await d.from('orders').select('status,total').eq('id', ctx.pos).single());
      const p1 = await rest(ctx.ownerToken, 'PATCH', `/orders?id=eq.${ctx.pos}`, { status: 'cancelled' });
      const p2 = await rest(ctx.ownerToken, 'PATCH', `/orders?id=eq.${ctx.pos}`, { total: 1 });
      const after = must(await d.from('orders').select('status,total').eq('id', ctx.pos).single());
      assert(after.status === before.status && Number(after.total) === Number(before.total), 'owner PATCH of orders.status/total did not change the order', { p1: p1.status, p2: p2.status, before, after });
      assert(p1.status >= 400 || (Array.isArray(p1.json) && p1.json.length === 0), 'owner PATCH orders.status is refused', p1);
      assert(p2.status >= 400 || (Array.isArray(p2.json) && p2.json.length === 0), 'owner PATCH orders.total is refused', p2);
      const pay = await rest(ctx.ownerToken, 'POST', '/payments', { organization_id: ctx.org, order_id: ctx.pos, method: 'cash', amount: 1 });
      assert(pay.status >= 400, 'owner cannot insert a payment directly', pay);
      assert(must(await d.from('payments').select('id').eq('order_id', ctx.pos)).length === 1, 'still exactly one payment');
      const anon = await rest(undefined, 'GET', `/orders?id=eq.${ctx.pos}`, undefined, '');
      assert(anon.status >= 400 || (Array.isArray(anon.json) && anon.json.length === 0), 'anon cannot read orders', anon);
      const bOrders = await rest(ctx.ownerBToken, 'GET', `/orders?organization_id=eq.${ctx.org}`, undefined, '');
      assert(bOrders.status === 200 && bOrders.json.length === 0, "second tenant cannot read this org's orders", bOrders);
      const bMenu = await rest(ctx.ownerBToken, 'GET', `/menu_items?organization_id=eq.${ctx.org}`, undefined, '');
      assert(bMenu.status === 200 && bMenu.json.length === 0, "second tenant cannot read this org's menu", bMenu);
      const own = await rest(ctx.ownerToken, 'GET', `/orders?id=eq.${ctx.pos}`, undefined, '');
      assert(own.status === 200 && own.json.length === 1, 'sanity: the owner CAN read their own order');
    });
  } finally {
    await cleanup(d);
  }
}

async function cleanup(d: any) {
  console.log('\n-- cleanup --');
  const del = async (what: string, p: PromiseLike<{ error: any }>) => { const r = await p; if (r.error) { residue.push(`${what}: ${r.error.message ?? JSON.stringify(r.error)}`); } };
  try { if (master?.pid) { try { process.kill(-master.pid, 'SIGTERM'); } catch { master.kill('SIGTERM'); } console.log('Master Admin stopped'); } } catch (e) { residue.push(`Master Admin process: ${e}`); }
  try {
    if (made.posOrders.length) await d.from('orders').update({ notes: TAG }).in('id', made.posOrders);
    if (made.rateCard) await del('rate card', d.from('rider_rate_cards').delete().eq('id', made.rateCard));
    const jobs = made.olOrders.length ? ((await d.from('delivery_jobs').select('id').in('ol_order_id', made.olOrders)).data ?? []).map((j: any) => j.id) : [];
    const staysForPurge = made.posOrders.length > 0; // the job rows hang on the append-only order trail; purge_test_orders.sh removes the jobs
    if (jobs.length && !staysForPurge) await del('delivery jobs', d.from('delivery_jobs').delete().in('id', jobs));
    if (made.olOrders.length) {
      // ol_orders.pos_order_id points at the tagged order; the purge script clears it, so the consumer order is removed only when nothing blocks it
      await del('ol_order_items', d.from('ol_order_items').delete().in('order_id', made.olOrders));
      const r = await d.rpc('ol_dev_purge_orders', { p_ids: made.olOrders, p_reason: 'golden-thread cleanup' });
      if (r.error) residue.push(`ol_orders (${made.olOrders.length}): ${r.error.message}`);
    }
    if (made.checkouts.length) await del('ol_checkouts', d.from('ol_checkouts').delete().in('id', made.checkouts));
    await del('ol_products', d.from('ol_products').delete().like('id', `gt-prod-${RUN}-%`));
    await del('ol_merchant_channels.store', d.from('ol_merchant_channels').update({ store_id: null, accepting: false }).in('organization_id', made.orgs));
    await del('ol_stores', d.from('ol_stores').delete().eq('id', `gt-store-${RUN}`));
    // a rider that cannot be deleted must at least stop being offered other people's jobs
    if (made.riders.length) await del('rider_availability offline', d.from('rider_availability').update({ online: false }).in('rider_id', made.riders));
    if (made.riders.length) await del('riders (ledger rows exist)', d.from('riders').delete().in('id', made.riders));
    if (made.authUsers.length) {
      await del('org_users', d.from('org_users').delete().in('user_id', made.authUsers));
      // menu_items stay on purpose: other local scripts pick "the first organization" and need it to have a menu
    }
    for (const id of made.orgs) await del(`organization ${id}`, d.from('organizations').delete().eq('id', id));
    for (const id of made.authUsers) { const r = await d.auth.admin.deleteUser(id); if (r.error) residue.push(`auth user ${id}: ${r.error.message}`); }
  } catch (e: any) { residue.push(`cleanup crashed: ${e?.message ?? e}`); }
}

const finish = (failed: boolean) => {
  console.log(`\nGolden thread: ${results.length}/7 steps passed${failed ? ' (STOPPED at first failure)' : ''}.`);
  if (residue.length) { console.log('Left behind (expected until the purge, or needs a look):'); residue.forEach(r => console.log('  - ' + r)); }
  console.log('Now run: /Users/lohit/agentic-os-coder/database/purge_test_orders.sh   (removes the ZZ-TEST golden-thread order, its job, KOT, payment, events).');
  console.log('After the purge the org, rider, rider earnings/cash rows, admin user golden.admin@proviyaa.test and the Master Admin platform_admins row remain as residue.');
  process.exit(failed ? 1 : 0);
};
main().then(() => finish(false)).catch(e => { if (!(e instanceof StepFailure)) console.error(e); finish(true); });
