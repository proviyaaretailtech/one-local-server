// Contract checks for the rider routes: the real route handlers run against the LOCAL Supabase and every answer is parsed with a
// zod schema copied from the Rider app's own contract (rider/src/api/dto.ts and mappers.ts: the fields mapJob, mapOffer and mapMe
// read, and the raw shapes the provider reads without a mapper). If the app would crash or misread an answer, a check fails here.
// Expo push and sign-in are simulated; the database is real. Refuses anything but localhost.
// CLEAN-UP: orders, order_events and payments are append-only here, so every `orders` row this creates is tagged
// notes = 'ZZ-TEST rider-contract-checks'. Afterwards run /Users/lohit/agentic-os-coder/database/purge_test_orders.sh.
// Jobs, riders, ol_orders, stores and the rate card are deleted by this script.
// Also checks that a proof of delivery is real (SRV-1): the rider is at the door, the photo is theirs, uploaded, made for this job and
// used once, a remote proof is refused whatever the method, a reason typed at pickup does not excuse being kilometres away, and the
// delivery code reaches the order's own customer and nobody else.
// Needs the local database (0029, 0030 and the rider money tables) and frontend/.env.localdb.off. Run from frontend/:
//   npx tsx scripts/rider-contract-checks.ts
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const ROOT = process.cwd();
for (const line of readFileSync(`${ROOT}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');
Object.assign(process.env, { DISPATCH_SERVICE_TOKEN: 'rc-token', DISPATCH_SIGNING_SECRET: 'rc-secret' });

const TAG = 'ZZ-TEST rider-contract-checks';
let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };
const parses = (what: string, schema: z.ZodTypeAny, value: unknown) => {
  const r = schema.safeParse(value);
  check(what, r.success, r.success ? undefined : r.error.issues.slice(0, 6).map(i => `${i.path.join('.')}: ${i.message}`));
  return r.success;
};

// ---------- the app's contract, copied (not imported) ----------
// The app's 15 job states (types/job.ts) and its KNOWN_CODES (api/httpClient.ts).
const JOB_STATES = ['created', 'offered', 'accepted', 'to_pickup', 'at_pickup', 'pickup_verified', 'picked_up', 'to_drop', 'at_drop', 'handover', 'proof', 'delivered', 'failed', 'returned', 'cancelled'] as const;
const KNOWN_CODES = ['rate_limited', 'account_invalid', 'name_mismatch', 'no_payout_account', 'insufficient_balance', 'payout_blocked', 'not_enrolled', 'suspended', 'cash_limit', 'offer_expired', 'already_taken', 'version_conflict', 'too_far', 'otp_invalid', 'otp_locked', 'out_of_zone', 'coming_soon', 'not_found', 'unauthorized', 'validation'];
const iso = z.string().refine(s => Number.isFinite(Date.parse(s)), 'ISO date');
const place = { lat: z.number(), lng: z.number() };
// JobDto, as mapJob reads it. payout_estimate is a number in the app's type; the server sends null while a city has no rate card (accepted: see report).
const JobDto = z.object({
  id: z.string(), order_ref: z.string(), state: z.enum(JOB_STATES), version: z.number().int(), category: z.string(),
  city_id: z.string(), pickup_zone: z.string(), drop_zone: z.string(),
  pickup: z.object({ ...place, name: z.string(), address: z.string().nullable(), area: z.string().optional(), phone_masked: z.boolean(), store_id: z.string().optional() }),
  drop: z.object({ ...place, area: z.string(), address: z.string().nullable(), customer_first_name: z.string() }),
  items: z.array(z.object({ id: z.string(), name: z.string(), qty: z.number() })),
  items_count: z.number(), cash_to_collect: z.number(), proof_methods: z.array(z.enum(['otp', 'photo', 'signature'])).min(1),
  payout_estimate: z.number().nullable(), surge_multiplier: z.number().optional(),
  eta: z.object({ to_pickup_min: z.number(), to_drop_min: z.number() }), distance_km: z.number(),
  pickup_distance_km: z.number().optional(), deadlines: z.object({ pickup_by: z.string().optional(), drop_by: z.string().optional() }),
  otp_attempts: z.number(), otp_locked: z.boolean(), rider_id: z.string().optional(), delivered_at: z.string().optional(),
  created_at: iso, updated_at: iso, flags: z.array(z.string()).optional(),
  // older callers still read these
  status: z.string(), display_state: z.string(),
});
const OfferDto = z.object({
  offer_id: z.string(), job: JobDto, mode: z.enum(['auto', 'manual']), round: z.number(), payout_estimate: z.number().nullable(), surge_multiplier: z.number(),
  pickup: z.object({ name: z.string(), area: z.string(), distance_km: z.number() }), drop: z.object({ area: z.string(), distance_km: z.number() }),
  eta_min: z.number(), offered_at: iso, expires_at: iso,
});
const JobEarningsDto = z.object({
  job_id: z.string(), base: z.number(), distance: z.number(), peak: z.number(), wait: z.number(), tip: z.number(), bonus: z.number(), total: z.number(),
  rule_version: z.number(), distance_km: z.number(), created_at: iso,
});
// Raw shapes the provider reads without a mapper (camelCase).
const ProofResult = z.object({ job: JobDto, earnings: JobEarningsDto, flagged: z.boolean().optional(), distance_from_drop_m: z.number().optional() });
const PickupVerify = z.discriminatedUnion('result', [
  z.object({ result: z.literal('verified'), job: JobDto }),
  z.object({ result: z.literal('mismatch'), expected_sku: z.string(), scanned: z.string(), job: JobDto }),
  z.object({ result: z.literal('incomplete'), missing: z.array(z.object({ id: z.string(), name: z.string(), qty: z.number() })).min(1), job: JobDto }),
]);
const NEXT_ACTIONS = ['wait', 'call_customer', 'call_merchant', 'escalate', 'continue', 'return_to_store', 'photo_fallback', 'await_operations', 'reassigned', 'share_location', 'dispute_address'] as const;
const ExceptionResponse = z.object({
  exception: z.object({ id: z.string(), jobId: z.string(), kind: z.string(), status: z.enum(['open', 'resolved']), createdAt: iso }),
  jobState: z.enum(JOB_STATES), nextActions: z.array(z.enum(NEXT_ACTIONS)).min(1), waitSeconds: z.number().optional(), message: z.string().optional(),
});
const JobDetail = z.object({
  job: JobDto,
  events: z.array(z.object({ id: z.string(), jobId: z.string(), fromState: z.enum(JOB_STATES).optional(), toState: z.enum(JOB_STATES), actor: z.enum(['rider', 'server', 'merchant', 'operations', 'customer']), createdAt: iso })),
  proof: z.object({ method: z.enum(['otp', 'photo', 'signature']), createdAt: iso, distanceFromDropM: z.number().optional() }).optional(),
  pickup_check: z.object({ method: z.enum(['scan', 'code', 'bypass']), result: z.string(), checkedAt: iso }).optional(),
  earnings: JobEarningsDto.optional(),
});
const MeDto = z.object({
  rider: z.object({
    id: z.string(), user_id: z.string(), phone: z.string(), full_name: z.string(), type: z.string(), status: z.string(), acceptance: z.string(),
    categories: z.array(z.string()), multi_store: z.boolean(), created_at: iso, updated_at: iso, cash_limit: z.number().optional(),
  }),
  cash_in_hand: z.number(), cash_limit: z.number(), online: z.boolean(),
  today: z.object({ earnings: z.number(), jobs: z.number() }), yesterday: z.object({ earnings: z.number(), jobs: z.number() }),
});
const ErrorDto = z.object({ detail: z.string(), code: z.string().optional() });

// Expo push and sign-in are simulated; PostgREST is the real local database.
const tokenToUser = new Map<string, string>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://exp.host/')) { const msgs = JSON.parse(init.body); return Response.json({ data: msgs.map(() => ({ status: 'ok' })) }); }
  if (url.endsWith('/auth/v1/user')) { const t = String(init?.headers?.Authorization ?? '').slice(7); return tokenToUser.has(t) ? Response.json({ id: tokenToUser.get(t) }) : new Response('{}', { status: 401 }); }
  return realFetch(input, init);
}) as typeof fetch;

async function main() {
  const { db } = await import('../server/db');
  const dispatch = await import('../server/dispatch');
  const offerRoute = await import('../app/api/rider/offers/current+api');
  const acceptRoute = await import('../app/api/rider/offers/[id]/accept+api');
  const availRoute = await import('../app/api/rider/availability+api');
  const jobRoute = await import('../app/api/rider/jobs/[id]+api');
  const currentRoute = await import('../app/api/rider/jobs/current+api');
  const stepRoute = await import('../app/api/rider/jobs/[id]/step+api');
  const oldVerifyRoute = await import('../app/api/rider/jobs/[id]/pickup-verify+api');
  const verifyRoute = await import('../app/api/rider/jobs/[id]/pickup/verify+api');
  const proofRoute = await import('../app/api/rider/jobs/[id]/proof+api');
  const problemRoute = await import('../app/api/rider/jobs/[id]/exception+api');
  const meRoute = await import('../app/api/rider/me+api');
  const uploadsRoute = await import('../app/api/rider/uploads+api');
  const store = await import('../server/store');
  const riderExtra = await import('../server/rider-extra');
  const { sha256 } = await import('../server/http');
  const d = db();
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };

  const started = new Date().toISOString();
  const orderIds: string[] = [];
  const uploadedPaths: string[] = [];
  let riderIds: string[] = [], org = '', rateCard: string | null = null;
  const tagOrders = async () => {
    const ols = must(await d.from('ol_orders').select('pos_order_id').in('id', orderIds));
    const pos = ols.map((o: any) => o.pos_order_id).filter(Boolean);
    if (pos.length) must(await d.from('orders').update({ notes: TAG }).in('id', pos));
  };

  try {
    // ---- seed (cleaned up at the end) ----
    org = must(await d.from('organizations').select('id').limit(1))[0].id as string;
    const { data: list } = await d.auth.admin.listUsers({ perPage: 20 });
    const taken = new Set(((await d.from('riders').select('user_id')).data ?? []).map((r: any) => r.user_id));
    const u = list!.users.map(x => x.id).filter(id => !taken.has(id)); // riders left by other scripts keep their users
    must(await d.from('ol_stores').upsert({ id: 'rc-store', name: 'RC Kitchen', organization_id: org, city_id: 'latur' }));
    must(await d.from('ol_merchant_channels').upsert({ organization_id: org, store_id: 'rc-store', accepting: true, address: 'Shop 4, Station Road, Latur', lat: 18.4088, lng: 76.5604 }));
    const mk = async (i: number, name: string, extra: any = {}) => must(await d.from('riders').insert({ user_id: u[i], full_name: name, type: 'solo', status: 'approved', vehicle: 'bike', ...extra }).select('id'))[0].id as string;
    const rA = await mk(0, 'RC Asha', { acceptance: 'manual' }), rB = await mk(1, 'RC Bala', { acceptance: 'manual' }), rC = await mk(2, 'RC Chitra', { status: 'submitted' });
    riderIds = [rA, rB, rC];
    const now = () => new Date().toISOString();
    must(await d.from('rider_availability').upsert([
      { rider_id: rA, online: false, lat: 18.4100, lng: 76.5604, last_seen_at: now() },
      { rider_id: rB, online: false, lat: 18.4300, lng: 76.5604, last_seen_at: now() },
    ]));
    const jwt = (i: number) => { const t = `rc-token-${i}-`.padEnd(40, 'x'); tokenToUser.set(t, u[i]); return t; };
    const req = (who: number, method: string, body?: unknown, headers: Record<string, string> = {}, query = '') =>
      new Request(`http://localhost/api/x${query}`, { method, headers: { authorization: `Bearer ${jwt(who)}`, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    let keyN = 0;
    const key = () => `rc-key-${Date.now()}-${++keyN}`;
    const call = async (handler: (r: Request, p: any) => Promise<Response> | Response, who: number, method: string, params: any, body?: unknown, o: { key?: string | null; query?: string } = {}) => {
      const headers: Record<string, string> = {};
      if (method === 'POST' && o.key !== null) headers['idempotency-key'] = o.key ?? key();
      const res = await handler(req(who, method, body, headers, o.query ?? ''), params);
      const text = res.status === 204 ? '' : await res.text();
      return { res, status: res.status, body: text ? JSON.parse(text) : null };
    };
    const A = 0, B = 1, C = 2;
    const order = async (extra: any = {}) => {
      const id = must(await d.from('ol_orders').insert({
        customer_hash: 'rc', items: [{ id: 'x', name: 'Biryani', qty: 2, price: 200 }], subtotal: 400, total: 460, store_id: 'rc-store', organization_id: org, eta_minutes: 30,
        payment_method: 'upi', payment_status: 'paid', // paid online: no cash to collect, so no cash-ledger row (those are append-only)
        delivery_address: { label: 'Home', text: 'Flat 4, Gandhi Chowk, Latur', lat: 18.4001, lng: 76.5702, notes: 'Ring twice' }, ...extra }).select('id'))[0].id as string;
      orderIds.push(id);
      must(await d.from('ol_order_items').insert([
        { order_id: id, name: 'Chicken Biryani', qty: 1, price: 220, mrp: 240 }, { order_id: id, name: 'Raita', qty: 2, price: 90, mrp: 90 }]));
      return id;
    };
    // The job waits for the restaurant to accept (trigger 'accepted'); the test plays the restaurant and releases it.
    const dispatchOrder = async (id: string) => {
      await dispatch.dispatchOrders([id]); await tagOrders();
      const j = must(await d.from('delivery_jobs').select('id, version').eq('ol_order_id', id).single());
      await dispatch.releaseJob(j.id, 0, null, `rc-release-${id}`);
    };
    const jobOf = async (olOrder: string) => must(await d.from('delivery_jobs').select('*').eq('ol_order_id', olOrder).single());

    // ---- errors the app must recognise ----
    let r = await call(offerRoute.GET, C, 'GET', {});
    check('a rider who is not approved yet gets the app\'s own code not_enrolled (403)', r.status === 403 && r.body.code === 'not_enrolled' && KNOWN_CODES.includes(r.body.code), r.body);
    r = await call(availRoute.POST, A, 'POST', {}, { online: 'yes' });
    check('a bad body is `validation`, a code the app knows', r.status === 400 && r.body.code === 'validation' && KNOWN_CODES.includes(r.body.code), r.body);
    r = await call(availRoute.POST, A, 'POST', {}, { online: true, lat: 18.41, lng: 76.5604 });
    check('going online works', r.status === 200 && r.body.online === true, r.body);

    // ---- offer, as the app reads it (rider A is manual) ----
    const o1 = await order();
    await dispatchOrder(o1);
    r = await call(offerRoute.GET, A, 'GET', {});
    if (parses('GET /offers/current parses as the app\'s OfferDto', OfferDto, r.body)) {
      check('the offer says manual, surge 1, offered_at set, pickup area is a neighbourhood, no pay while there is no rate card',
        r.body.mode === 'manual' && r.body.surge_multiplier === 1 && r.body.pickup.area === 'Station Road' && r.body.payout_estimate === null && r.body.job.state === 'offered', r.body);
    }
    // Pay comes only from the city's rate card, in rupees: base 20 + 5/km, at least 30.
    const card = must(await d.from('rider_rate_cards').insert({ city_id: 'latur', base_minor: 2000, per_km_minor: 500, min_minor: 3000, active: true }).select('id'));
    rateCard = card[0].id;
    const km = must(await d.rpc('dispatch_km', { a_lat: 18.4088, a_lng: 76.5604, b_lat: 18.4001, b_lng: 76.5702 })) as number | null;
    r = await call(offerRoute.GET, A, 'GET', {});
    const expectPay = Math.max(3000, 2000 + Math.round(500 * Number(km ?? 0))) / 100;
    check('with a rate card the offer and the job carry the pay in rupees (minor units / 100)', r.status === 200 && r.body.payout_estimate === expectPay && r.body.job.payout_estimate === expectPay, { got: r.body?.payout_estimate, expectPay });
    must(await d.from('rider_rate_cards').delete().eq('id', rateCard)); rateCard = null;
    r = await call(offerRoute.GET, A, 'GET', {});
    check('without it pay is null again, never invented', r.status === 200 && r.body.payout_estimate === null, r.body);
    const offerId = r.body.offer_id;
    must(await d.from('riders').update({ acceptance: 'auto' }).eq('id', rA));
    r = await call(offerRoute.GET, A, 'GET', {});
    check('mode follows the rider\'s acceptance setting (auto)', r.status === 200 && r.body.mode === 'auto', r.body);
    must(await d.from('riders').update({ acceptance: 'manual' }).eq('id', rA));
    r = await call(acceptRoute.POST, A, 'POST', { id: offerId }, undefined, { key: null });
    parses('POST /offers/:id/accept returns a JobDto', JobDto, r.body);
    check('accepting gives the app state "accepted" (not the database status "assigned")', r.status === 200 && r.body.state === 'accepted' && r.body.status === 'assigned' && r.body.display_state === 'accepted', r.body);
    const j1 = await jobOf(o1);

    // ---- the job, as the app reads it ----
    r = await call(jobRoute.GET, A, 'GET', { id: j1.id });
    if (parses('GET /jobs/:id parses as JobDto', JobDto, r.body)) {
      check('items, zones, otp fields, timestamps and phone flag are present',
        r.body.items.length === 2 && r.body.items_count === 2 && r.body.city_id === 'latur' && r.body.otp_attempts === 0 && r.body.otp_locked === false &&
        r.body.pickup.phone_masked === true && r.body.proof_methods.includes('otp') && r.body.rider_id === rA && r.body.drop.address === null, r.body);
    }
    r = await call(currentRoute.GET, A, 'GET', {});
    parses('GET /jobs/current parses as JobDto', JobDto, r.body);
    must(await d.from('rider_availability').update({ online: false }).eq('rider_id', rA));
    r = await call(jobRoute.GET, A, 'GET', { id: j1.id });
    check('eta is an object with both numbers even when the rider has no live position', r.status === 200 && typeof r.body.eta.to_pickup_min === 'number' && typeof r.body.eta.to_drop_min === 'number', r.body);
    must(await d.from('rider_availability').update({ online: true, lat: 18.41, lng: 76.5604, last_seen_at: now() }).eq('rider_id', rA));

    // ---- steps, recorded_at, version conflicts ----
    const step = (id: string, body: any, k?: string) => call(stepRoute.POST, A, 'POST', { id }, body, { key: k });
    let v = j1.version;
    r = await call(stepRoute.POST, A, 'POST', { id: j1.id }, { to: 'to_pickup', version: v }, { key: null });
    check('a command with no Idempotency-Key: 400 validation', r.status === 400 && r.body.code === 'validation', r.body);
    r = await step(j1.id, { to: 'to_pickup', version: v }, 'rc-step-0001-a');
    check('step to_pickup: state to_pickup', r.status === 200 && r.body.state === 'to_pickup' && r.body.version === v + 1 && parses('step answer parses as JobDto', JobDto, r.body), r.body);
    r = await step(j1.id, { to: 'at_pickup', version: v, lat: 18.4088, lng: 76.5604, accuracy_m: 8 }, 'rc-step-0002-a');
    check('a stale version: 409 version_conflict with server_version and job', r.status === 409 && r.body.code === 'version_conflict' && r.body.server_version === v + 1 && parses('the conflict carries a JobDto', JobDto, r.body.job), r.body);
    v += 1;
    r = await step(j1.id, { to: 'handover', version: v }, 'rc-step-0003-a');
    check('a step the job cannot take is folded into version_conflict (the app refetches), original kept as reason', r.status === 409 && r.body.code === 'version_conflict' && r.body.reason === 'invalid_transition', r.body);
    const early = new Date(Date.now() - 120_000).toISOString();
    r = await step(j1.id, { to: 'at_pickup', version: v, lat: 18.4088, lng: 76.5604, accuracy_m: 8, recorded_at: early }, 'rc-step-0004-a'); v = r.body.version;
    check('at_pickup: state at_pickup', r.body.state === 'at_pickup', r.body);
    const ev = must(await d.from('delivery_events').select('meta').eq('job_id', j1.id).eq('kind', 'delivery.at_pickup'));
    check('recorded_at from the phone is stored on the event, not the arrival time', ev.length === 1 && Date.parse(ev[0].meta.recorded_at) === Date.parse(early), ev);

    // ---- pickup/verify, the app's contract ----
    const items = must(await d.from('ol_order_items').select('id, name').eq('order_id', o1)) as { id: string; name: string }[];
    const verify = (id: string, body: any, k?: string) => call(verifyRoute.POST, A, 'POST', { id }, body, { key: k });
    r = await verify(j1.id, { method: 'typed', code: 'WRONG-1', items: items.map(i => ({ id: i.id, ok: true })), version: v });
    check('a wrong code: result mismatch with expected_sku and scanned, job unchanged', r.status === 200 && parses('mismatch parses', PickupVerify, r.body) && r.body.result === 'mismatch' && r.body.scanned === 'WRONG-1' && r.body.job.version === v, r.body);
    r = await verify(j1.id, { method: 'scan', code: j1.order_no, items: [{ id: items[0].id, ok: true }, { id: items[1].id, ok: false }], version: v });
    check('a missing item: result incomplete lists it, job unchanged', r.status === 200 && parses('incomplete parses', PickupVerify, r.body) && r.body.result === 'incomplete' && r.body.missing[0].id === items[1].id && r.body.job.version === v, r.body);
    r = await verify(j1.id, { method: 'bypass', items: [], version: v });
    check('bypass without a reason: 400 validation', r.status === 400 && r.body.code === 'validation', r.body);
    r = await verify(j1.id, { method: 'typed', code: String(j1.order_no).toLowerCase(), items: items.map(i => ({ id: i.id, ok: true })), version: v }, 'rc-verify-0001-a');
    check('the right code, all items: verified, state pickup_verified, version up', r.status === 200 && parses('verified parses', PickupVerify, r.body) && r.body.result === 'verified' && r.body.job.state === 'pickup_verified' && r.body.job.version === v + 1, r.body);
    const again = await verify(j1.id, { method: 'typed', code: String(j1.order_no).toLowerCase(), items: items.map(i => ({ id: i.id, ok: true })), version: v }, 'rc-verify-0001-a');
    check('the same verify sent again replays (header set, no second change)', again.status === 200 && again.res.headers.get('Idempotent-Replay') === 'true' && again.body.job.version === v + 1, again.body);
    v += 1;

    // ---- to the door, proof ----
    for (const [to, extra] of [['picked_up', {}], ['to_drop', { recorded_at: new Date(Date.now() - 60_000).toISOString() }], ['at_drop', {}], ['handover', {}], ['proof', {}]] as [string, any][]) {
      r = await step(j1.id, { to, version: v, lat: 18.4001, lng: 76.5702, accuracy_m: 8, ...extra }, `rc-step-${to}-a`); v = r.body.version;
      if (!parses(`step ${to} parses as JobDto`, JobDto, r.body) || r.body.state !== to) check(`state after ${to} is ${to}`, false, r.body);
    }
    const proof = (body: any, k?: string) => call(proofRoute.POST, A, 'POST', { id: j1.id }, { version: v, lat: 18.4001, lng: 76.5702, cash_collected: 0, ...body }, { key: k });
    r = await proof({ method: 'otp', code: '0000' === await dispatch.deliveryOtp(o1) ? '0001' : '0000' });
    check('a wrong delivery code: 422 otp_invalid with attempts_left', r.status === 422 && r.body.code === 'otp_invalid' && KNOWN_CODES.includes(r.body.code) && typeof r.body.attempts_left === 'number', r.body);
    const doneAt = new Date(Date.now() - 30_000).toISOString();
    r = await proof({ method: 'otp', code: await dispatch.deliveryOtp(o1), recorded_at: doneAt }, 'rc-proof-0001-a');
    if (parses('POST /proof parses as the app\'s ProofResult (job, earnings, flagged)', ProofResult, r.body)) {
      check('delivered: state delivered, earnings all 0 while there is no rate card', r.status === 200 && r.body.job.state === 'delivered' && r.body.earnings.total === 0 && r.body.flagged === false, r.body);
    }
    const proofRow = must(await d.from('delivery_proofs').select('recorded_at').eq('job_id', j1.id));
    check('recorded_at on the proof is stored', proofRow.length === 1 && Date.parse(proofRow[0].recorded_at) === Date.parse(doneAt), proofRow);
    r = await call(jobRoute.GET, A, 'GET', { id: j1.id }, undefined, { query: '?detail=true' });
    if (parses('GET /jobs/:id?detail=true parses as the app\'s JobDetail', JobDetail, r.body)) {
      check('detail carries events up to delivered, the proof and the pickup check', r.body.events.some((e: any) => e.toState === 'delivered') && r.body.events[0].toState === 'accepted' && r.body.proof?.method === 'otp' && r.body.pickup_check?.result === 'verified' && r.body.earnings?.total === 0, r.body);
    }
    r = await call(jobRoute.GET, A, 'GET', { id: j1.id });
    check('a plain GET still returns just the job', r.status === 200 && r.body.id === j1.id && !('events' in r.body), r.body);
    r = await call(currentRoute.GET, A, 'GET', {});
    check('a delivered job is no longer current (204)', r.status === 204);

    // ---- /me ----
    r = await call(meRoute.GET, A, 'GET', {});
    if (parses('GET /me parses as the app\'s MeDto', MeDto, r.body)) {
      check('me: online, today counts the delivery, money comes from the ledgers (0 here: no rate card was active)', r.body.online === true && r.body.today.jobs === 1 && r.body.today.earnings === 0 && r.body.cash_in_hand === 0 && r.body.rider.id === rA, r.body);
    }
    r = await call(meRoute.GET, C, 'GET', {});
    check('me for a rider who is not approved: 403 not_enrolled', r.status === 403 && r.body.code === 'not_enrolled', r.body);

    // ---- exceptions: the app's kinds ----
    must(await d.from('rider_availability').update({ online: false }).in('rider_id', [rA, rB]));
    const newJob = async (extra: any = {}) => {
      must(await d.from('rider_availability').update({ online: true, last_seen_at: now(), lat: 18.41, lng: 76.56 }).eq('rider_id', rA));
      must(await d.from('riders').update({ acceptance: 'auto' }).eq('id', rA));
      const id = await order(extra); await dispatchOrder(id);
      const j = await jobOf(id);
      must(await d.from('riders').update({ acceptance: 'manual' }).eq('id', rA));
      must(await d.from('rider_availability').update({ online: false }).eq('rider_id', rA));
      return j;
    };
    const problem = (id: string, body: any, k?: string) => call(problemRoute.POST, A, 'POST', { id }, body, { key: k });
    // ---- SRV-1: a proof of delivery must be real ----
    const limits = () => (globalThis as unknown as { __onecityLimits?: Map<string, unknown> }).__onecityLimits?.clear(); // many commands in one minute: the per-rider limit is not what is tested here
    limits();
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    const DEVICE = 'rc-customer-device-0123456789abcdef', STRANGER = 'rc-someone-else-device-0123456789abcd';
    const customerHash = await sha256(DEVICE);
    const asCustomer = (device = DEVICE) => new Request('http://localhost/api/x', { headers: { 'x-customer-key': device } });
    const upload = async (who: number, body: any, send = true) => {
      const x = await call(uploadsRoute.POST, who, 'POST', {}, body, { key: null });
      if (x.status !== 200) throw new Error(`upload slot refused: ${JSON.stringify(x.body)}`);
      const row = must(await d.from('delivery_assets').select('storage_path').eq('id', x.body.asset_id).single());
      uploadedPaths.push(row.storage_path);
      if (send) { const put = await realFetch(x.body.upload_url, { method: 'PUT', headers: { 'content-type': body.content_type }, body: JPEG }); if (!put.ok) throw new Error(`upload failed ${await put.text()}`); }
      return x.body.asset_id as string;
    };

    // The delivery code reaches the customer who placed the order, and only while a rider has the delivery.
    const lonely = await order({ customer_hash: customerHash });
    check('SRV-1: no delivery code is shown for an order no rider has yet', !(await store.getOrder(asCustomer(), lonely)).delivery_code);
    const jp = await newJob({ customer_hash: customerHash });
    const jpCode = await dispatch.deliveryOtp(jp.ol_order_id);
    const shown = await store.getOrder(asCustomer(), jp.ol_order_id);
    check('SRV-1: the order\'s own customer is shown the delivery code once a rider has the delivery', shown.delivery_code === jpCode && /^\d{4,6}$/.test(jpCode), { shown: shown.delivery_code });
    await store.getOrder(asCustomer(STRANGER), jp.ol_order_id).then(() => check('SRV-1: another device cannot read this order, so not its code', false), e => check('SRV-1: another device cannot read this order, so not its code', e.status === 404, e.status));
    const listedMine = await store.listOrders(asCustomer());
    check('SRV-1: the customer\'s order list carries the code only for the delivery a rider has', listedMine.find(o => o.id === jp.ol_order_id)?.delivery_code === jpCode && !listedMine.find(o => o.id === lonely)?.delivery_code);
    check('SRV-1: a stranger\'s order list has neither the order nor a code', !(await store.listOrders(asCustomer(STRANGER))).some(o => o.id === jp.ol_order_id || o.delivery_code));
    r = await call(jobRoute.GET, A, 'GET', { id: jp.id });
    check('SRV-1: the rider\'s own view of the job never contains the code', r.status === 200 && !JSON.stringify(r.body).includes(`"${jpCode}"`) && !('delivery_code' in r.body), r.body.proof_methods);

    // Walk the job to the door.
    let pv = jp.version, n = 0;
    const stepTo = async (to: string, extra: any = {}) => {
      const x = await call(stepRoute.POST, A, 'POST', { id: jp.id }, { to, version: pv, ...extra }, { key: `rc-sec-${to}-${++n}` });
      if (x.status !== 200) throw new Error(`step ${to}: ${JSON.stringify(x.body)}`);
      pv = x.body.version; return x;
    };
    await stepTo('to_pickup'); await stepTo('at_pickup', { lat: 18.4088, lng: 76.5604, accuracy_m: 8 });
    r = await call(oldVerifyRoute.POST, A, 'POST', { id: jp.id }, { version: pv, items_ok: true }); pv = r.body.version;
    for (const to of ['picked_up', 'to_drop', 'at_drop', 'handover']) await stepTo(to, { lat: 18.4001, lng: 76.5702, accuracy_m: 8 });
    const sendProof = (body: any, k: string) => call(proofRoute.POST, A, 'POST', { id: jp.id }, { version: pv, lat: 18.4001, lng: 76.5702, cash_collected: 0, ...body }, { key: `rc-sec-proof-${k}` });
    const stillOpen = async () => { const j = await jobOf(jp.ol_order_id); return j.status === 'at_drop' && j.otp_attempts === 0 && must(await d.from('delivery_proofs').select('id').eq('job_id', jp.id)).length === 0; };

    // Remote completion is refused, whichever proof is offered.
    r = await sendProof({ method: 'otp', code: jpCode, lat: 18.45, lng: 76.5604 }, 'far-otp');
    check('SRV-1: the right code sent from 5 km away is refused (422 too_far with the distance)', r.status === 422 && r.body.code === 'too_far' && KNOWN_CODES.includes(r.body.code) && r.body.distance_m > 4000 && r.body.max_m === 300, r.body);
    check('SRV-1: ...and that remote try was not counted as a wrong code and recorded nothing', await stillOpen());
    r = await sendProof({ method: 'photo', asset_id: crypto.randomUUID(), lat: 18.45, lng: 76.5604 }, 'far-photo');
    check('SRV-1: a photo proof from 5 km away is refused the same way (the location is checked before the file)', r.status === 422 && r.body.code === 'too_far', r.body);
    r = await sendProof({ method: 'otp', code: jpCode, lat: 18.4036, lng: 76.5702 }, 'edge');
    check('SRV-1: 390 m from the drop pin is still outside the 300 m door radius', r.status === 422 && r.body.code === 'too_far' && r.body.distance_m > 300 && r.body.distance_m < 450, r.body);
    r = await sendProof({ method: 'otp', code: jpCode, lat: null, lng: null }, 'nowhere');
    check('SRV-1: a proof with no location is refused (400 validation)', r.status === 400 && r.body.code === 'validation', r.body);
    r = await sendProof({ method: 'fingerprint' }, 'method');
    check('SRV-1: a method the job does not take is refused (400 validation)', r.status === 400 && r.body.code === 'validation', r.body);
    r = await sendProof({ method: 'photo' }, 'no-asset');
    check('SRV-1: a photo proof must name its file (400 validation)', r.status === 400 && r.body.code === 'validation', r.body);
    check('SRV-1: none of those changed the job', await stillOpen());

    // The file: really uploaded, the rider's own, the right kind, an image, made for this job, made after the job was theirs.
    const neverSent = await upload(A, { kind: 'proof_photo', content_type: 'image/jpeg', job_id: jp.id }, false);
    r = await sendProof({ method: 'photo', asset_id: neverSent }, 'never-sent');
    check('SRV-1: a file id whose bytes were never uploaded is refused (422 upload_missing)', r.status === 422 && r.body.code === 'upload_missing', r.body);
    const others = await upload(B, { kind: 'proof_photo', content_type: 'image/jpeg' });
    r = await sendProof({ method: 'photo', asset_id: others }, 'others');
    check('SRV-1: another rider\'s uploaded file is refused (404, as if it did not exist)', r.status === 404, r.body);
    const wrongKind = await upload(A, { kind: 'exception_photo', content_type: 'image/jpeg', job_id: jp.id });
    r = await sendProof({ method: 'photo', asset_id: wrongKind }, 'wrong-kind');
    check('SRV-1: a file made for something else (a problem photo) is refused as a proof (400)', r.status === 400 && r.body.code === 'validation', r.body);
    const signatureAsPhoto = await upload(A, { kind: 'proof_signature', content_type: 'image/png', job_id: jp.id });
    r = await sendProof({ method: 'photo', asset_id: signatureAsPhoto }, 'sig-as-photo');
    check('SRV-1: a signature file does not stand in for a photo proof (400)', r.status === 400 && r.body.code === 'validation', r.body);
    const pdf = await upload(A, { kind: 'proof_photo', content_type: 'application/pdf', job_id: jp.id });
    r = await sendProof({ method: 'photo', asset_id: pdf }, 'pdf');
    check('SRV-1: a PDF is not a photo (422)', r.status === 422 && r.body.code === 'validation', r.body);
    const forAnotherJob = await upload(A, { kind: 'proof_photo', content_type: 'image/jpeg', job_id: j1.id });
    r = await sendProof({ method: 'photo', asset_id: forAnotherJob }, 'other-job');
    check('SRV-1: a file made for another delivery is refused (422)', r.status === 422 && r.body.code === 'validation' && /another delivery/.test(r.body.detail), r.body);
    const stale = await upload(A, { kind: 'proof_photo', content_type: 'image/jpeg' }); // made with no job_id (how the Rider app does it today)...
    must(await d.from('delivery_assets').update({ created_at: new Date(Date.now() - 86_400_000).toISOString() }).eq('id', stale)); // ...but from before the job was accepted
    r = await sendProof({ method: 'photo', asset_id: stale }, 'stale');
    check('SRV-1: a file from before the rider took the job is refused (422)', r.status === 422 && /before you took/.test(r.body.detail), r.body);
    check('SRV-1: none of those refused files changed the job either', await stillOpen());

    // A real proof: at the door (222 m is inside the radius), a file made for this job.
    const good = await upload(A, { kind: 'proof_photo', content_type: 'image/jpeg', job_id: jp.id });
    r = await sendProof({ method: 'photo', asset_id: good, lat: 18.4021, lng: 76.5702 }, 'good');
    check('SRV-1: a real photo proof at the door delivers the job', r.status === 200 && r.body.job.state === 'delivered' && r.body.flagged === false && r.body.distance_from_drop_m > 150 && r.body.distance_from_drop_m <= 300, r.body);
    const stored = must(await d.from('delivery_proofs').select('method, asset_id').eq('job_id', jp.id));
    check('SRV-1: the proof row names the file', stored.length === 1 && stored[0].method === 'photo' && stored[0].asset_id === good, stored);
    const retry = await sendProof({ method: 'photo', asset_id: good, lat: 18.4021, lng: 76.5702 }, 'good');
    check('SRV-1: the same proof sent again (a retry after a lost answer) replays the stored answer, not "file already used"', retry.status === 200 && retry.res.headers.get('Idempotent-Replay') === 'true' && retry.body.job.state === 'delivered', retry.body);
    await riderExtra.confirmJobAsset({ id: rA }, jp, good, ['proof_photo'], 'proof').then(() => check('SRV-1: a file already used in a proof cannot be used again', false), e => check('SRV-1: a file already used in a proof cannot be used again (409)', e.status === 409, e.status));
    const lateCode = await store.getOrder(asCustomer(), jp.ol_order_id);
    check('SRV-1: once delivered the order no longer shows a delivery code', !lateCode.delivery_code && lateCode.status === 'delivered', lateCode.status);

    // A reason typed at pickup excuses a poor GPS fix, not being somewhere else.
    limits();
    const jr = await newJob();
    let rv = jr.version;
    const stepJr = (body: any, k: string) => call(stepRoute.POST, A, 'POST', { id: jr.id }, { version: rv, ...body }, { key: `rc-sec-jr-${k}` });
    r = await stepJr({ to: 'to_pickup' }, 'a'); rv = r.body.version;
    r = await stepJr({ to: 'at_pickup', lat: 18.45, lng: 76.5604, accuracy_m: 8, reason: 'GPS keeps drifting' }, 'b');
    check('SRV-1: "GPS drifting" from 5 km away no longer gets a rider into at_pickup (422 too_far)', r.status === 422 && r.body.code === 'too_far', r.body);
    r = await stepJr({ to: 'at_pickup', lat: 18.4120, lng: 76.5604, accuracy_m: 8 }, 'c');
    check('SRV-1: 356 m from the pickup with no reason is refused (the 150 m rule)', r.status === 422 && r.body.code === 'too_far', r.body);
    r = await stepJr({ to: 'at_pickup', lat: 18.4120, lng: 76.5604, accuracy_m: 8, reason: 'The shop is round the back' }, 'd');
    check('SRV-1: 356 m away with a reason still works (flagged, inside the 500 m a reason can excuse)', r.status === 200 && r.body.state === 'at_pickup', r.body);
    rv = r.body.version;
    const flag = must(await d.from('delivery_events').select('meta').eq('job_id', jr.id).eq('kind', 'delivery.at_pickup'));
    check('SRV-1: ...and the arrival is flagged too_far on the event', JSON.stringify(flag[0]?.meta?.soft_flags) === '["too_far"]', flag);
    // A photo sent with a problem is held to the same rules as a proof photo.
    const problemJr = (body: any, k: string) => call(problemRoute.POST, A, 'POST', { id: jr.id }, { version: rv, kind: 'other', note: 'checking', lat: 18.4088, lng: 76.5604, ...body }, { key: `rc-sec-jr-p-${k}` });
    const proofKindPhoto = await upload(A, { kind: 'proof_photo', content_type: 'image/jpeg', job_id: jr.id });
    r = await problemJr({ asset_id: proofKindPhoto }, 'kind');
    check('SRV-1: a problem photo must be a problem-photo file (400)', r.status === 400 && r.body.code === 'validation', r.body);
    r = await problemJr({ asset_id: await upload(A, { kind: 'exception_photo', content_type: 'image/jpeg' }, false) }, 'never');
    check('SRV-1: a problem photo that was never uploaded is refused (422 upload_missing)', r.status === 422 && r.body.code === 'upload_missing', r.body);
    const problemPhoto = await upload(A, { kind: 'exception_photo', content_type: 'image/jpeg', job_id: jr.id });
    r = await problemJr({ asset_id: problemPhoto }, 'good');
    check('SRV-1: a real problem photo for this job is accepted and attached', r.status === 200 && must(await d.from('delivery_exceptions').select('asset_id').eq('job_id', jr.id))[0]?.asset_id === problemPhoto, r.body);

    for (const [kind, dbKind] of [['cannot_access', 'address'], ['proof_failed', 'other'], ['not_ready', 'not_ready']] as const) {
      const j = await newJob();
      check(`a new job for the ${kind} case is assigned`, j.status === 'assigned' && j.rider_id === rA, j);
      r = await problem(j.id, { kind, note: 'gate locked', lat: 18.4, lng: 76.57, version: j.version });
      if (parses(`exception ${kind} parses as the app's ExceptionResponse`, ExceptionResponse, r.body)) {
        const row = must(await d.from('delivery_exceptions').select('kind, note').eq('id', r.body.exception.id))[0];
        check(`${kind} is stored as ${dbKind}, the app's kind kept in the note, answered with the app's kind and the prior job state`,
          r.status === 200 && r.body.exception.kind === kind && row.kind === dbKind && (kind === dbKind || String(row.note).startsWith(`[${kind}]`)) && r.body.jobState === 'accepted' && r.body.state === 'accepted' && r.body.display_state === 'exception', { body: r.body, row });
      }
    }
    const j4 = await newJob();
    r = await problem(j4.id, { kind: 'teleported', lat: 18.4, lng: 76.57, version: j4.version });
    check('an unknown kind: 400 validation', r.status === 400 && r.body.code === 'validation', r.body);
    r = await problem(j4.id, { kind: 'vehicle', lat: 18.4, lng: 76.57, version: j4.version + 5 });
    check('a problem on a stale version: 409 version_conflict with the job', r.status === 409 && r.body.code === 'version_conflict' && r.body.job?.id === j4.id, r.body);

    // ---- the older pickup-verify route still works ----
    // direct status writes are refused (0229): walk the job to at_pickup through the real dispatch_step door
    let v4 = j4.version;
    for (const to of ['to_pickup', 'at_pickup']) {
      const k = `rc-walk-${j4.id.slice(0, 8)}-${to}`;
      must(await d.rpc('dispatch_step', { p_job: j4.id, p_rider: rA, p_to: to, p_expected: v4, p_key: k, p_hash: k, p_lat: 18.4088, p_lng: 76.5604, p_accuracy: 10, p_recorded_at: null, p_reason: null, p_request_id: k }));
      v4 = must(await d.from('delivery_jobs').select('version').eq('id', j4.id).single()).version;
    }
    r = await call(oldVerifyRoute.POST, A, 'POST', { id: j4.id }, { version: v4, items_ok: true });
    check('the old /pickup-verify route still verifies and answers the job', r.status === 200 && r.body.display_state === 'pickup_verified' && r.body.state === 'pickup_verified', r.body);


    // ---- every error the routes emit carries a code the app knows ----
    r = await call(jobRoute.GET, A, 'GET', { id: 'not-a-uuid' });
    check('an unknown job: 404 not_found', r.status === 404 && ErrorDto.safeParse(r.body).success && r.body.code === 'not_found' && KNOWN_CODES.includes(r.body.code), r.body);
    const bare = await jobRoute.GET(new Request('http://localhost/api/x'), { id: j1.id });
    check('no sign-in: 401', bare.status === 401);

    console.log(`\n${passed} rider contract checks passed`);
  } finally {
    // ---- cleanup: everything except the append-only `orders` rows, which are tagged for purge_test_orders.sh ----
    try {
      if (orderIds.length) await tagOrders();
      const c = db();
      if (uploadedPaths.length) await c.storage.from('rider-uploads').remove(uploadedPaths);
      if (rateCard) await c.from('rider_rate_cards').delete().eq('id', rateCard);
      const log = (what: string, e: any) => { if (e) { console.error('cleanup:', what, e.message ?? e); process.exitCode = 1; } };
      if (orderIds.length) {
        log('delivery_jobs', (await c.from('delivery_jobs').delete().in('ol_order_id', orderIds)).error);
        log('ol_orders', (await c.rpc('ol_dev_purge_orders', { p_ids: orderIds, p_reason: 'rider-contract-checks cleanup' })).error);
      }
      if (riderIds.length) log('riders', (await c.from('riders').delete().in('id', riderIds)).error);
      if (org) log('merchant channel', (await c.from('ol_merchant_channels').delete().eq('store_id', 'rc-store')).error);
      log('store', (await c.from('ol_stores').delete().eq('id', 'rc-store')).error);
      const { count } = await c.from('orders').select('id', { count: 'exact', head: true }).like('notes', 'ZZ-TEST%');
      const { count: untagged } = await c.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', started).not('notes', 'like', 'ZZ-TEST%');
      console.log(`left for purge: ${count} orders tagged ZZ-TEST (${untagged ?? 0} created since start and not tagged). Run /Users/lohit/agentic-os-coder/database/purge_test_orders.sh`);
    } catch (e) { console.error('cleanup failed', e); process.exitCode = 1; }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
