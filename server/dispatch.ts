// Dispatch: every successful delivery order pings the rider pool until a driver is assigned.
// Contract: "One Local Delivery app /docs/RIDER_DISPATCH_CONTRACT.md". Tables and atomic functions:
// db/migrations/0029_ol_dispatch.sql. This file only validates, shapes and notifies; every state
// change is one database function, so two taps or two servers can never both win.
//
// Three callers:
//   * the order flow (store.ts on a cash order, payments.ts when money is confirmed) calls
//     dispatchOrders() in-process the moment an order is successful;
//   * other services (VINII, operations tooling) call the same thing over HTTP, /api/dispatch/*,
//     signed with a service credential (serviceRequest below) — never with a user's token;
//   * riders answer offers through /api/rider/* (rider.ts).
// An order never fails because dispatch is down: the hook logs, the order stays, and the sweep
// (POST /api/dispatch/sweep, also run from rider heartbeats) retries any order that has no job yet.
import { distanceKm, serviceability } from './catalog';
import { pickupEnforcement, pickupStatus } from './pickup-location';
import { db, dbConfigured, fromDbError, rpc } from './db';
import { isProduction } from './env';
import { constantTimeEqual, HttpError, hmacHex, readText, sha256, signatureOk } from './http';
import { createDeliveryOtp, NEW_DIGITS, NEW_SCHEME } from './delivery-otp';
import { publishOutbox } from './outbox';
import { pushToRestaurant, pushToRider } from './push';
import { cancelUnfulfillable, completeQueuedRefunds, pollGatewayRefunds, refundDue } from './refunds';

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (detail: string) => new HttpError(400, detail, undefined, 'invalid_payload');

// ---------- Configuration ----------
// DISPATCH_SERVICE_TOKEN   bearer credential of the services allowed to call /api/dispatch/*
// DISPATCH_SIGNING_SECRET  HMAC secret for X-Signature
// DISPATCH_OTP_SECRET      (or OTP_HMAC_SECRET) secret that derives the customers' delivery codes and keys the stored verifier. It is NOT the signing
//                          secret on purpose: every service that signs calls holds the signing secret, and none of them may be able to
//                          work out a customer's code. Required in production (and must differ from the signing secret there);
//                          outside production it falls back to the signing secret so a local setup needs one value less.
// DISPATCH_ALLOWED_ORGS    optional comma list of organization ids the credential may dispatch for ('*' = also stores with no merchant).
//                          Every route honours it: a restricted credential sees and changes only those organizations' jobs, and cannot
//                          run the sweep (which works on every job).
const env = () => {
  const secret = process.env.DISPATCH_SIGNING_SECRET?.trim() ?? '';
  // Either name of the delivery-code secret counts as "set up" (OTP_HMAC_SECRET is the one delivery-otp.ts keys new codes with).
  const explicit = process.env.DISPATCH_OTP_SECRET?.trim() || process.env.OTP_HMAC_SECRET?.trim() || '';
  return {
    token: process.env.DISPATCH_SERVICE_TOKEN?.trim() ?? '',
    secret,
    otpSecret: isProduction() ? (explicit && explicit !== secret ? explicit : '') : explicit || secret,
    orgs: (process.env.DISPATCH_ALLOWED_ORGS ?? '').split(',').map(s => s.trim()).filter(Boolean),
  };
};
export const dispatchConfigured = () => dbConfigured() && !!env().otpSecret;

// ---------- Service credential ----------
const sameSecret = async (a: string, b: string) => (await hmacHex('compare', a)) === (await hmacHex('compare', b));
const MAX_SKEW_MS = 5 * 60_000;

export type ServiceCall = {
  requestId: string; idempotencyKey: string | null; body: Row;
  // Throws 403 unless the credential may act for this organization (null = a store with no merchant).
  allowOrg: (organizationId: unknown) => void;
  // True when DISPATCH_ALLOWED_ORGS limits this credential to some organizations.
  restricted: boolean; orgs: string[];
};

// What X-Signature signs (SRV-6): the method, the path and query exactly as called, the timestamp header, and the SHA-256 of the raw
// body, one per line. A signature taken from one call therefore works for that call only: not on another path, not with another
// method, not with another body, and not outside the timestamp window. (It used to cover only "timestamp.body", so a captured
// GET signature, whose body is empty, opened every other GET for five minutes.)
export const serviceSigningString = (method: string, pathAndQuery: string, stamp: string, bodySha256: string) =>
  `${method.toUpperCase()}\n${pathAndQuery}\n${stamp}\n${bodySha256}`;

// An Idempotency-Key names one request: reusing it for a different method, path or body is a caller bug (or an attack on a
// retry), so it is refused instead of silently doing the new thing under the old key. Kept in this process for a day.
const seenKeys = ((globalThis as unknown as { __onecityIdem?: Map<string, { fingerprint: string; at: number }> }).__onecityIdem ??= new Map());
function bindIdempotencyKey(key: string, fingerprint: string) {
  const now = Date.now();
  if (seenKeys.size > 10_000) for (const [k, v] of seenKeys) if (now - v.at > 86_400_000) seenKeys.delete(k);
  if (seenKeys.size > 20_000) seenKeys.clear();
  const prior = seenKeys.get(key);
  if (prior && now - prior.at < 86_400_000) {
    if (prior.fingerprint !== fingerprint) throw new HttpError(422, 'This Idempotency-Key was already used for a different request.', undefined, 'idempotency_mismatch');
    return;
  }
  seenKeys.set(key, { fingerprint, at: now });
}

// Bearer token + X-Timestamp + X-Signature = HMAC-SHA256(secret, serviceSigningString(...)). A user's JWT is not the service
// token, so it is refused here whatever it is valid for elsewhere.
export async function serviceRequest(request: Request, opts: { write: boolean }): Promise<ServiceCall> {
  const { token, secret, orgs } = env();
  if (!token || !secret) throw new HttpError(503, 'Dispatch is not set up on this server yet.', undefined, 'not_configured');
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !(await sameSecret(auth.slice(7).trim(), token))) throw new HttpError(401, 'Not allowed.', undefined, 'unauthorized');

  const requestId = request.headers.get('x-request-id')?.trim() ?? '';
  if (!/^[\w:.-]{1,128}$/.test(requestId)) throw new HttpError(400, 'X-Request-Id is required.', undefined, 'invalid_request');
  const stamp = request.headers.get('x-timestamp')?.trim() ?? '';
  const sent = /^\d{10}$/.test(stamp) ? Number(stamp) * 1000 : Date.parse(stamp);
  if (!Number.isFinite(sent) || Math.abs(Date.now() - sent) > MAX_SKEW_MS) throw new HttpError(401, 'The request is too old or has no valid X-Timestamp.', undefined, 'stale_request');

  const raw = await readText(request, 64 * 1024);
  const url = new URL(request.url);
  const bodyHash = await sha256(raw);
  const signed = serviceSigningString(request.method, `${url.pathname}${url.search}`, stamp, bodyHash);
  if (!(await signatureOk(secret, signed, request.headers.get('x-signature')))) throw new HttpError(401, 'The signature does not match.', undefined, 'bad_signature');

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || null;
  if (opts.write && (!idempotencyKey || !/^[\w:.-]{8,200}$/.test(idempotencyKey))) throw new HttpError(400, 'Idempotency-Key is required.', undefined, 'invalid_request');
  if (opts.write && idempotencyKey) bindIdempotencyKey(idempotencyKey, await sha256(`${request.method}\n${url.pathname}${url.search}\n${bodyHash}`));

  let body: Row = {};
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = []; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Request body must be a JSON object');
  }
  const allowOrg = (organizationId: unknown) => {
    if (!orgs.length || (orgs.includes('*') && !organizationId)) return;
    if (!organizationId || !orgs.includes(String(organizationId))) throw new HttpError(403, 'This credential may not dispatch for that organization.', undefined, 'organization_not_allowed');
  };
  return { requestId, idempotencyKey, body, allowOrg, restricted: orgs.length > 0, orgs };
}

// ---------- Tenant scope (SRV-6) ----------
// A credential limited to some organizations (DISPATCH_ALLOWED_ORGS) reaches only their jobs. A job of another organization answers
// exactly like a job that does not exist, so a restricted credential cannot even probe for ids.
const notFoundJob = () => new HttpError(404, 'Job not found', undefined, 'not_found');

export async function scopeJob(call: ServiceCall, key: { id?: string; ol_order_id?: string }) {
  if (!call.restricted) return;
  const value = key.id ?? key.ol_order_id ?? '';
  if (!UUID.test(value)) throw notFoundJob();
  const { data, error } = await db().from('delivery_jobs').select('organization_id').eq(key.id ? 'id' : 'ol_order_id', value).maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw notFoundJob();
  try { call.allowOrg(data.organization_id); } catch { throw notFoundJob(); }
}

export async function scopeException(call: ServiceCall, exceptionId: string) {
  if (!call.restricted) return;
  if (!UUID.test(exceptionId)) throw new HttpError(404, 'Problem not found', undefined, 'not_found');
  const { data, error } = await db().from('delivery_exceptions').select('job_id').eq('id', exceptionId).maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw new HttpError(404, 'Problem not found', undefined, 'not_found');
  await scopeJob(call, { id: data.job_id as string });
}

// The sweep works on every job, so only an unrestricted credential may run it.
export function requireUnrestricted(call: ServiceCall) {
  if (call.restricted) throw new HttpError(403, 'This credential is limited to some organizations and cannot run the sweep.', undefined, 'organization_not_allowed');
}

// POST /api/dispatch/jobs: the caller says which organization the order is for; the order itself says which it really is. A
// restricted credential must not be able to attach an order that is not its own to its own organization, so the claim is checked
// against the order (and, before the order is adopted into the shared orders table, against the store it was placed with).
export async function verifyJobOrigin(payload: JobPayload): Promise<JobPayload> {
  const { data: order, error } = await db().from('ol_orders').select('organization_id, store_id').eq('id', payload.ol_order_id).maybeSingle();
  if (error) fromDbError(error);
  if (!order) throw new HttpError(404, 'Order not found', undefined, 'not_found');
  let real: string | null = (order.organization_id as string | null) ?? null;
  if (!real && order.store_id) {
    const { data: store, error: storeError } = await db().from('ol_stores').select('organization_id').eq('id', order.store_id).maybeSingle();
    if (storeError) fromDbError(storeError);
    real = (store?.organization_id as string | null) ?? null;
  }
  if (payload.organization_id && payload.organization_id !== real) {
    throw new HttpError(403, 'organization_id does not match the order.', undefined, 'organization_not_allowed');
  }
  return { ...payload, organization_id: real };
}

// ---------- The delivery code ----------
// Derived from the order, never stored; the database keeps only a verifier. New jobs: 6 digits, HMAC keyed with OTP_HMAC_SECRET
// (otp_scheme 'hmac_v1'); jobs already in flight stay 4-digit 'sha256_v1' and keep verifying. All of it lives in delivery-otp.ts.
// One Local shows the code to the customer (store.ts, the order's own tracking reply); the rider never receives it.
const delivery = createDeliveryOtp(() => env().otpSecret);
export const { deliveryOtp, otpHash, verifyDeliveryCode } = delivery;

// ---------- Creating the job ----------
export type JobPayload = {
  ol_order_id: string; pos_order_id: string | null; organization_id: string | null; store_id: string | null;
  order_no: string | null; kitchen_no: string | null; payment_mode: 'cod' | 'online'; cash_to_collect: number;
  items: { count: number; temperature: 'hot' | 'cold' | 'ambient' }; prep_minutes: number | null; promised_by: string | null;
  pickup: { name: string; address: string | null; lat: number; lng: number; phone: string | null };
  drop: { area: string | null; address: string | null; lat: number; lng: number; instructions: string | null; customer_first_name: string | null; customer_phone: string | null };
  vehicle: string; dispatch_trigger: 'placed' | 'accepted';
};

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
function coordinate(v: unknown, lo: number, hi: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

// What POST /api/dispatch/jobs accepts (contract 2.1). Errors name the field.
export function parseJobPayload(b: Row): JobPayload {
  if (typeof b.ol_order_id !== 'string' || !UUID.test(b.ol_order_id)) throw bad('ol_order_id must be a uuid');
  for (const k of ['pos_order_id', 'organization_id'] as const) if (b[k] != null && (typeof b[k] !== 'string' || !UUID.test(b[k]))) throw bad(`${k} must be a uuid`);
  if (b.payment_mode !== 'cod' && b.payment_mode !== 'online') throw bad('payment_mode must be cod or online');
  const cash = b.cash_to_collect ?? 0;
  if (typeof cash !== 'number' || !Number.isFinite(cash) || cash < 0 || cash > 100_000) throw bad('cash_to_collect must be a number from 0');
  if (b.payment_mode === 'online' && cash !== 0) throw bad('cash_to_collect must be 0 for an order already paid online');
  const items = (b.items ?? {}) as Row;
  const count = items.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 500) throw bad('items.count must be a whole number from 1');
  const temperature = items.temperature ?? 'ambient';
  if (!['hot', 'cold', 'ambient'].includes(temperature)) throw bad('items.temperature must be hot, cold or ambient');
  const prep = b.prep_minutes ?? null;
  if (prep !== null && (!Number.isInteger(prep) || prep < 0 || prep > 240)) throw bad('prep_minutes must be 0 to 240');
  const promised = b.promised_by == null ? null : Number.isFinite(Date.parse(String(b.promised_by))) ? new Date(String(b.promised_by)).toISOString() : (() => { throw bad('promised_by must be a date and time'); })();
  const vehicle = b.vehicle ?? 'any';
  if (!['any', 'bike', 'scooter', 'cycle', 'car'].includes(vehicle)) throw bad('vehicle must be any, bike, scooter, cycle or car');
  const trigger = b.dispatch_trigger ?? 'accepted'; // wait for the restaurant to accept (database default, migration 0106)
  if (trigger !== 'placed' && trigger !== 'accepted') throw bad('dispatch_trigger must be placed or accepted');

  const pickup = (b.pickup ?? {}) as Row, drop = (b.drop ?? {}) as Row;
  const pickupName = text(pickup.name, 120);
  if (!pickupName) throw bad('pickup.name is required');
  const pLat = coordinate(pickup.lat, -90, 90), pLng = coordinate(pickup.lng, -180, 180);
  if (pLat === null || pLng === null) throw new HttpError(422, 'The restaurant has no map location yet, so a rider cannot be sent.', undefined, 'no_pickup_location');
  const dLat = coordinate(drop.lat, -90, 90), dLng = coordinate(drop.lng, -180, 180);
  if (dLat === null || dLng === null) throw bad('drop.lat and drop.lng are required: a rider navigates to a map point, not to text');
  if (!serviceability({ lat: dLat, lng: dLng }).serviceable) throw new HttpError(422, 'That address is outside the delivery area.', undefined, 'outside_delivery_area');

  return {
    ol_order_id: b.ol_order_id, pos_order_id: b.pos_order_id ?? null, organization_id: b.organization_id ?? null, store_id: text(b.store_id, 120),
    order_no: text(b.order_no, 40), kitchen_no: text(b.kitchen_no, 40), payment_mode: b.payment_mode, cash_to_collect: Math.round(cash * 100) / 100,
    items: { count, temperature }, prep_minutes: prep, promised_by: promised,
    pickup: { name: pickupName, address: text(pickup.address, 300), lat: pLat, lng: pLng, phone: text(pickup.phone, 20) },
    drop: {
      area: text(drop.area, 120), address: text(drop.address, 300), lat: dLat, lng: dLng, instructions: text(drop.instructions, 300),
      customer_first_name: text(drop.customer_first_name, 60), customer_phone: text(drop.customer_phone, 20),
    },
    vehicle, dispatch_trigger: trigger,
  };
}

type Created = { job_id: string; status: string; version: number; replayed: boolean; dispatch_trigger: string; released: boolean };

// The one entry point for "a delivery order is successful". Idempotent per order.
export async function createJob(payload: JobPayload, requestId: string) {
  const as = { scheme: NEW_SCHEME, digits: NEW_DIGITS };
  const otp = await otpHash(payload.ol_order_id, await delivery.deliveryOtp(payload.ol_order_id, as), NEW_SCHEME);
  // A replay for an order that already has a job returns that job and ignores these (its own scheme stays).
  const created = await rpc<Created>('dispatch_create_job', { p: { ...payload, otp_hash: otp, otp_scheme: NEW_SCHEME, otp_digits: NEW_DIGITS, request_id: requestId } });
  // Trigger 'placed': ping the pool now. Also heals a job whose first attempt died between create and release.
  if (created.dispatch_trigger === 'placed' && !created.released) {
    await releaseJob(created.job_id, payload.prep_minutes, null, requestId);
  }
  return { created: !created.replayed, job: await jobView(created.job_id) };
}

// ---------- Offering to riders ----------
type Offer = { result: 'offered' | 'waiting' | 'no_rider' | 'not_open' | 'not_released'; assignment_id?: string; rider_id?: string; round?: number; expires_at?: string; auto?: boolean; escalated?: boolean; status?: string };

// What happens after the database picked (or failed to pick) a rider: ring them, or auto-assign, or alert.
async function afterOffer(jobId: string, offer: Offer, requestId: string): Promise<Offer> {
  if (offer.result === 'offered' && offer.rider_id && offer.assignment_id) {
    const { data: job } = await db().from('delivery_jobs').select('pickup_name, drop_area, cash_to_collect, items_count').eq('id', jobId).maybeSingle();
    if (offer.auto) {
      try {
        await rpc('dispatch_answer', { p_assignment: offer.assignment_id, p_rider: offer.rider_id, p_accept: true, p_reason: null, p_request_id: requestId });
        await pushToRider(offer.rider_id, { title: 'New job assigned', body: `${job?.pickup_name ?? 'Pickup'} → ${job?.drop_area ?? 'customer'}`, data: { type: 'job_assigned', job_id: jobId } });
        return { ...offer, result: 'offered', status: 'assigned' };
      } catch (error) {
        // Someone else took it, or it lapsed: the sweep moves on. Never fatal.
        console.warn('[dispatch] auto-accept failed', jobId, error instanceof HttpError ? error.detail : error);
        return offer;
      }
    }
    await pushToRider(offer.rider_id, {
      title: 'New delivery job',
      body: `${job?.pickup_name ?? 'Pickup'} → ${job?.drop_area ?? 'customer'}${job?.cash_to_collect ? ` · collect ₹${Math.round(Number(job.cash_to_collect))}` : ''}`,
      data: { type: 'job_offer', job_id: jobId, offer_id: offer.assignment_id, expires_at: offer.expires_at },
    });
  } else if (offer.result === 'no_rider' && !offer.escalated) {
    const { data: job } = await db().from('delivery_jobs').select('organization_id, order_no').eq('id', jobId).maybeSingle();
    if (job?.organization_id) {
      await pushToRestaurant(job.organization_id, { title: 'No rider found yet', body: `Order ${job.order_no ?? ''} is waiting for a rider. We are on it.`, data: { type: 'no_rider', job_id: jobId } });
    }
  }
  return offer;
}

// Move a released job to its next step: lapse an overdue offer, offer to the next rider, or escalate.
export async function advanceJob(jobId: string, requestId: string): Promise<Offer> {
  return afterOffer(jobId, await rpc<Offer>('dispatch_offer_next', { p_job: jobId, p_request_id: requestId }), requestId);
}

export async function releaseJob(jobId: string, prepMinutes: number | null, expectedVersion: number | null, requestId: string): Promise<Offer> {
  const offer = await rpc<Offer>('dispatch_release', { p_job: jobId, p_prep: prepMinutes, p_expected: expectedVersion, p_request_id: requestId });
  return afterOffer(jobId, offer, requestId);
}

export async function cancelJob(jobId: string, reason: string, expectedVersion: number | null, requestId: string) {
  // Who to tell that the card should close: a rider with a live offer, or the assigned rider.
  const [{ data: live }, { data: job }] = await Promise.all([
    db().from('delivery_assignments').select('rider_id').eq('job_id', jobId).is('outcome', null).maybeSingle(),
    db().from('delivery_jobs').select('rider_id').eq('id', jobId).maybeSingle(),
  ]);
  const result = await rpc<{ status: string; version: number; replayed: boolean }>('dispatch_cancel', { p_job: jobId, p_reason: reason, p_expected: expectedVersion, p_request_id: requestId });
  const rider = job?.rider_id ?? live?.rider_id;
  if (rider && !result.replayed) await pushToRider(rider as string, { title: 'Order cancelled', body: 'This delivery was cancelled.', data: { type: 'job_cancelled', job_id: jobId }, sound: false });
  return { ...result, job: await jobView(jobId) };
}

// Operations takes a job from its rider before pickup and offers it again to riders not yet tried.
export async function reassignJob(jobId: string, reason: string, requestId: string) {
  const { data: before } = await db().from('delivery_jobs').select('rider_id').eq('id', jobId).maybeSingle();
  const result = await rpc<{ status: string; version: number }>('dispatch_reassign', { p_job: jobId, p_reason: reason, p_actor: 'operations', p_request_id: requestId });
  if (before?.rider_id) await pushToRider(before.rider_id as string, { title: 'Job reassigned', body: 'This delivery was given to another rider.', data: { type: 'job_cancelled', job_id: jobId }, sound: false });
  await advanceJob(jobId, requestId);
  return { ...result, job: await jobView(jobId) };
}

// Operations closes a problem a rider reported. A reassignment starts a fresh set of offers straight away.
export async function resolveException(exceptionId: string, outcome: string, note: string | null, requestId: string) {
  if (!UUID.test(exceptionId)) throw new HttpError(404, 'Problem not found', undefined, 'not_found');
  const { data: ex } = await db().from('delivery_exceptions').select('job_id, rider_id').eq('id', exceptionId).maybeSingle();
  const result = await rpc<{ job_id: string; outcome: string; replayed: boolean }>('dispatch_resolve_exception', { p_exception: exceptionId, p_outcome: outcome, p_note: note, p_actor: 'operations', p_request_id: requestId });
  if (!result.replayed && ex?.rider_id) {
    const tell: Record<string, string> = { resume: 'You can carry on with this delivery.', reassign: 'This delivery was given to another rider.', return: 'Return the order to the restaurant.', fail: 'This delivery was closed.', cancel: 'This delivery was cancelled.' };
    await pushToRider(ex.rider_id as string, { title: 'Problem resolved', body: tell[outcome], data: { type: outcome === 'resume' ? 'job_resumed' : 'job_cancelled', job_id: result.job_id }, sound: false });
  }
  if (outcome === 'reassign' && !result.replayed) await advanceJob(result.job_id, requestId);
  return { ...result, job: await jobView(result.job_id) };
}

// The event outbox, read by a cursor: One Local, POS and Master keep the last id they handled. A credential limited to some
// organizations gets only their jobs' events; the cursor still moves past the others, so a page can come back short or empty
// and the caller simply asks again from `next`.
export async function eventsAfter(after: number, limit: number, call?: ServiceCall) {
  const { data, error } = await db().from('delivery_events').select('id, job_id, kind, v, meta, created_at').gt('id', after).order('id').limit(Math.min(Math.max(limit, 1), 500));
  if (error) fromDbError(error);
  const next = data?.length ? data[data.length - 1].id : after;
  if (!call?.restricted || !data?.length) return { events: data ?? [], next };
  const ids = [...new Set(data.map(e => e.job_id as string))];
  const { data: jobs, error: jobError } = await db().from('delivery_jobs').select('id, organization_id').in('id', ids);
  if (jobError) fromDbError(jobError);
  const visible = new Set<string>();
  for (const j of jobs ?? []) { try { call.allowOrg(j.organization_id); visible.add(j.id as string); } catch { /* another organization's job */ } }
  return { events: data.filter(e => visible.has(e.job_id as string)), next };
}

// ---------- Reading a job ----------
const SPEED_KMH = 20;
const first = (name: unknown) => String(name ?? '').trim().split(/\s+/)[0] || null;

async function loadJob(key: { id?: string; ol_order_id?: string }): Promise<Row> {
  const value = key.id ?? key.ol_order_id ?? '';
  if (!UUID.test(value)) throw new HttpError(404, 'Job not found', undefined, 'not_found');
  const { data, error } = await db().from('delivery_jobs').select('*').eq(key.id ? 'id' : 'ol_order_id', value).maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw new HttpError(404, 'Job not found', undefined, 'not_found');
  return data;
}

// What One Local's tracking screen and VINII's order detail read (contract 2.3). No rider phone.
export async function jobView(jobId: string, by: 'id' | 'ol_order_id' = 'id') {
  const job = await loadJob(by === 'id' ? { id: jobId } : { ol_order_id: jobId });
  const [{ data: assignments }, { data: events }] = await Promise.all([
    db().from('delivery_assignments').select('round, outcome').eq('job_id', job.id).order('round', { ascending: false }).limit(1),
    db().from('delivery_events').select('kind, created_at').eq('job_id', job.id).order('id'),
  ]);
  let rider: Row | null = null, eta: number | null = null;
  if (job.rider_id) {
    const [{ data: r }, { data: a }] = await Promise.all([
      db().from('riders').select('full_name, vehicle').eq('id', job.rider_id).maybeSingle(),
      db().from('rider_availability').select('lat, lng, last_seen_at').eq('rider_id', job.rider_id).maybeSingle(),
    ]);
    rider = { first_name: first(r?.full_name), vehicle: r?.vehicle ?? null, lat: a?.lat ?? null, lng: a?.lng ?? null, seen_at: a?.last_seen_at ?? null };
    if (a?.lat != null && a?.lng != null) {
      const target = ['picked_up', 'at_drop'].includes(job.status) ? { lat: job.drop_lat, lng: job.drop_lng } : { lat: job.pickup_lat, lng: job.pickup_lng };
      eta = Math.max(1, Math.ceil((distanceKm({ lat: a.lat, lng: a.lng }, target) / SPEED_KMH) * 60));
    }
  }
  const last = assignments?.[0];
  const offerState = job.status === 'cancelled' ? 'cancelled' : job.rider_id ? 'accepted' : job.escalated_at ? 'no_rider' : !job.released_at ? 'waiting_for_restaurant' : 'searching';
  return {
    job_id: job.id, ol_order_id: job.ol_order_id, status: job.status, version: job.version,
    offer: { round: last?.round ?? 0, state: offerState },
    rider, eta_minutes: eta,
    timeline: (events ?? []).map(e => ({ kind: e.kind, at: e.created_at })),
  };
}

export const jobViewByOrder = (olOrderId: string) => jobView(olOrderId, 'ol_order_id');

// ---------- What a rider may see (contract 3, privacy rules RD4) ----------
// Area before pickup, address after. A first name. The customer's phone only while the job is live.
const ACTIVE = ['assigned', 'at_pickup', 'picked_up', 'at_drop', 'exception'];
const area2 = (n: number) => Math.round(n * 100) / 100; // about 1 km: a neighbourhood, not a door

// The Rider app's fifteen states, worked out from the nine statuses plus the step (contract section 2).
export function displayState(job: Row): string {
  const { status, step } = job;
  if (status === 'assigned') return step ?? 'accepted';
  if (status === 'at_pickup') return step === 'verified' ? 'pickup_verified' : 'at_pickup';
  if (status === 'picked_up') return step ?? 'picked_up';
  if (status === 'at_drop') return step === 'handover' ? 'handover' : step === 'proof' ? 'proof' : 'at_drop';
  if (status === 'exception') return step === 'failed' || step === 'returned' ? step : 'exception';
  return status;
}

// What the rider may do next (the commands of section 5 of the contract).
export function nextCommands(job: Row): string[] {
  const by: Record<string, string[]> = {
    accepted: ['step:to_pickup'], to_pickup: ['step:at_pickup'], at_pickup: ['pickup-verify'], pickup_verified: ['step:picked_up'],
    picked_up: ['step:to_drop'], to_drop: ['step:at_drop'], at_drop: ['step:handover'], handover: ['step:proof', 'proof'], proof: ['proof'],
  };
  const live = ['assigned', 'at_pickup', 'picked_up', 'at_drop'].includes(job.status);
  return live ? [...(by[displayState(job)] ?? []), 'exception'] : [];
}

export function riderJob(job: Row, riderPoint?: { lat: number; lng: number } | null) {
  // A job in exception shows what it showed before the problem.
  const revealed = ['picked_up', 'at_drop', 'delivered'].includes(job.status === 'exception' ? job.exception_from_status : job.status);
  const pickupPoint = { lat: job.pickup_lat, lng: job.pickup_lng };
  return {
    id: job.id, order_ref: job.order_no, state: job.status, status: job.status, step: job.step ?? null, display_state: displayState(job),
    next: nextCommands(job), exception: job.status === 'exception' ? { kind: job.exception_kind, closed: ['failed', 'returned'].includes(job.step) } : null,
    version: job.version, category: 'on_order',
    pickup: {
      name: job.pickup_name,
      address: ACTIVE.includes(job.status) || revealed ? job.pickup_address : null,
      lat: job.pickup_lat, lng: job.pickup_lng,
      phone: ACTIVE.includes(job.status) ? job.pickup_phone : null,
    },
    drop: {
      area: job.drop_area,
      address: revealed ? job.drop_address : null,
      lat: revealed ? job.drop_lat : area2(job.drop_lat), lng: revealed ? job.drop_lng : area2(job.drop_lng),
      customer_first_name: job.customer_first_name,
      customer_phone: ACTIVE.includes(job.status) ? job.customer_phone : null,
      instructions: revealed ? job.drop_notes : null,
    },
    items_count: job.items_count, temperature: job.temperature, cash_to_collect: Number(job.cash_to_collect),
    promised_by: job.promised_by, payout_estimate: null, // rider pay rates are not set yet (contract open question 5)
    distance_km: Math.round(distanceKm(pickupPoint, { lat: job.drop_lat, lng: job.drop_lng }) * 10) / 10,
    eta: riderPoint ? { to_pickup_min: Math.max(1, Math.ceil((distanceKm(riderPoint, pickupPoint) / SPEED_KMH) * 60)) } : null,
  };
}

// ---------- The order flow ----------
let warned = false;
const reported = new Set<string>();

// Why an order cannot go to a restaurant (the reasons ol_adopt_marketplace_order gives), in words for the customer's order screen.
const NOT_ADOPTED: Record<string, string> = {
  merchant_not_accepting: 'The restaurant is not taking orders right now',
  items_not_mapped: 'An item in this order is not on the restaurant\'s menu any more',
  store_not_onboarded: 'This store is not taking One Local orders',
  // 0344: the pickup point was cleared or changed between checkout and payment; no rider could collect it
  pickup_location_missing: 'The restaurant has no pickup location for riders',
  pickup_location_unverified: 'The restaurant has not confirmed its pickup location',
};

// Brings marketplace orders into the ONE shared orders table (the restaurant, its kitchen ticket and the POS all read
// that same row; see database migration 0106). Returns the ids that are on their way to a restaurant and may be dispatched.
// An order no restaurant can take is NOT left sitting as "placed" with the customer charged (SRV-2): it is cancelled and, if it was paid
// online, refunded (refunds.ts; a refund that cannot be made right now stays queued for the sweep). The one exception is a
// store with no merchant outside production (demo data), which is left alone as before. Never throws: placing an order must not
// fail because of this step; an order that hit an error stays as it is and the sweep tries it again.
export async function adoptOrders(orderIds: string[]): Promise<string[]> {
  if (!dbConfigured()) return orderIds;
  const ready: string[] = [];
  for (const id of orderIds) {
    try {
      const r = await rpc<{ adopted: boolean; replayed?: boolean; reason?: string; organization_id?: string; pos_order_id?: string; display_no?: string; accept_window_seconds?: number }>(
        'ol_adopt_marketplace_order', { p_ol_order: id });
      if (r.adopted) {
        ready.push(id);
        if (!r.replayed && r.organization_id) {
          const window = Number(r.accept_window_seconds) || 240;
          await pushToRestaurant(r.organization_id, {
            title: `New order ${r.display_no}`,
            body: `New One Local order, accept within ${window % 60 === 0 ? `${window / 60} minute${window === 60 ? '' : 's'}` : `${window} seconds`}`,
            data: { type: 'new_order', order_id: r.pos_order_id }, ttl: window,
          });
        }
        continue;
      }
      console.warn('[orders] order', id, 'is not on the shared orders table yet:', r.reason);
      if (r.reason === 'store_not_onboarded' && !isProduction()) { ready.push(id); continue; } // demo store: nothing to cancel, nothing to charge
      const why = NOT_ADOPTED[r.reason ?? ''];
      if (why) await cancelUnfulfillable(id, why);
    } catch (error) { console.error('[orders] order', id, 'could not be moved to the shared orders table:', error instanceof HttpError ? `${error.code ?? error.status} ${error.detail}` : error); }
  }
  return ready;
}

// The first reason ol_restaurant_live gives, in words for the checkout ("<store> cannot take your order right now: ...").
const NOT_LIVE: Record<string, string> = {
  pos_offline: 'the restaurant is offline right now', paused: 'the restaurant is not accepting orders', platform_hold: 'the restaurant is paused by One Local',
  outside_hours: 'the restaurant is closed now', no_location: 'the restaurant has no map location yet', not_approved: 'it is not set up to receive orders',
  suspended: 'it is not set up to receive orders', not_listed: 'it is not set up to receive orders', not_found: 'it is not set up to receive orders',
};

// An Item Master listing sells its restaurant's menu items under made-up product ids: "<store id>_<menu item id>" (and
// "<store id>_<menu item id>_<variant id>"), see marketplace.ts listingCatalog. This gives the menu item back, or null for any other id.
// Those ids are not rows in ol_products, so the order line records the menu item itself (store.ts), which is what the restaurant's side
// of the database (ol_adopt_marketplace_order) reads.
const UUID_TAIL = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function listingMenuItemId(storeId: string | null, productId: string): string | null {
  if (!storeId || !productId.startsWith(`${storeId}_`)) return null;
  const m = productId.slice(storeId.length + 1).match(new RegExp(`^(${UUID_TAIL})(?:_${UUID_TAIL})?$`, 'i'));
  return m ? m[1].toLowerCase() : null;
}

// Before a customer is charged or an order is placed: every store in the checkout must be a merchant that can take it right now,
// and the drop must be a map point inside the delivery area (a rider navigates to a point, and dispatch refuses one outside the
// area). Refused here, nothing is charged and nothing is created. Checked again after payment by adoptOrders, because a restaurant
// can pause in between. `online` = the customer is about to be charged.
export async function assertFulfillable(
  groups: { store_id: string | null; store_name: string; items: { id: string }[] }[],
  address: { lat: number | null; lng: number | null } | null, online: boolean,
) {
  if (!dbConfigured()) return; // no database: nothing is dispatched and nothing is charged (UI work)
  const point = address && address.lat != null && address.lng != null ? { lat: address.lat, lng: address.lng } : null;
  if (online && !point) throw new HttpError(400, 'Please pick your delivery address on the map before paying.', undefined, 'address_needs_point');
  if (point && !serviceability(point).serviceable) throw new HttpError(422, 'That address is outside the delivery area.', undefined, 'outside_delivery_area');
  for (const g of groups) {
    const refuse = (why: string) => new HttpError(409, `${g.store_name || 'This store'} cannot take your order right now${why ? `: ${why}` : ''}. Nothing was charged.`, undefined, 'merchant_unavailable');
    const { data: store, error } = g.store_id ? await db().from('ol_stores').select('organization_id, is_demo').eq('id', g.store_id).maybeSingle() : { data: null, error: null };
    if (error) fromDbError(error);
    if (!store?.organization_id) {
      // A store with no restaurant behind it can never be fulfilled. Demo stores stay orderable for cash outside production, so
      // the app can be tried with the sample catalogue; they are never charged for.
      if (!online && !isProduction() && store?.is_demo) continue;
      throw refuse('it is not set up to receive orders');
    }
    const listed = g.items.map(i => listingMenuItemId(g.store_id, i.id)).filter((m): m is string => !!m);
    // Guard 2 (0580): the database's one live rule (switch, platform hold, approval, map point, a POS seen in the last 5 minutes, business hours),
    // asked before anyone is charged. The same rule the validate-restaurant-live Edge Function and the ghost watcher use.
    const [live, { data: channel }, pickup, { data: products, error: productError }, { data: menu, error: menuError }] = await Promise.all([
      rpc<{ allow_order: boolean; reasons: string[] }>('ol_restaurant_live', { p_org: store.organization_id }),
      db().from('ol_merchant_channels').select('accepting, lat, lng, city_id').eq('organization_id', store.organization_id).maybeSingle(),
      pickupStatus(store.organization_id),
      db().from('ol_products').select('id, menu_item_id').in('id', g.items.map(i => i.id)),
      listed.length ? db().from('menu_items').select('id').eq('organization_id', store.organization_id).in('id', listed) : Promise.resolve({ data: [] as { id: string }[], error: null }),
    ]);
    if (productError) fromDbError(productError);
    if (menuError) fromDbError(menuError);
    if (!live?.allow_order) throw refuse(NOT_LIVE[(live?.reasons ?? [])[0] ?? ''] ?? 'the restaurant is not accepting orders');
    // Pickup point (specs/restaurant-pickup-location): riders go where the restaurant confirmed. No point, or a point nobody at the
    // restaurant confirmed (in a city set to 'verified'), or a disputed one, is refused with its own reason code. The database checks
    // the same again when the payment lands (ol_adopt_marketplace_order, 0344). pickup null = no 0341 table yet: coordinates only.
    const notReady = (code: string) => new HttpError(409, `${g.store_name || 'This restaurant'} is not ready for delivery yet. Nothing was charged.`, undefined, code);
    if (!channel || channel.lat == null || channel.lng == null || pickup === 'missing') throw notReady('pickup_location_missing');
    if (pickup === 'disputed' || (pickup && pickup !== 'verified' && (await pickupEnforcement(channel.city_id)) === 'verified')) throw notReady('pickup_location_unverified');
    // An item is "mapped" when the restaurant can find it on its own menu: a catalogue product linked to a menu item (ol_products), or a menu
    // item of this very restaurant sold under its listing (the made-up id above).
    const linked = new Map((products ?? []).map(p => [p.id as string, p.menu_item_id as string | null]));
    const onMenu = new Set((menu ?? []).map(m => String(m.id).toLowerCase()));
    const mapped = (id: string) => !!linked.get(id) || onMenu.has(listingMenuItemId(g.store_id, id) ?? '');
    if (g.items.some(i => !mapped(i.id))) throw refuse('an item is not on the restaurant\'s menu');
  }
}

// An order is successful: cash orders when placed, online orders when the payment is confirmed. Every
// delivery order gets one job. Never throws: an order must not fail because dispatch is down.
export async function dispatchOrders(orderIds: string[]) {
  if (!dbConfigured()) return; // no database (UI work with `expo start`): there is no rider pool either
  if (!dispatchConfigured()) {
    if (!warned) { warned = true; console.warn('[dispatch] DISPATCH_SIGNING_SECRET is not set: orders are placed but no rider is pinged.'); }
    return;
  }
  for (const id of orderIds) {
    try { await createJobForOrder(id); }
    catch (error) { console.error('[dispatch] order', id, 'has no delivery job yet, the sweep will retry it:', error instanceof HttpError ? `${error.code ?? error.status} ${error.detail}` : error); }
  }
}

// Builds the contract's payload from the stored order, store and customer, then creates the job.
export async function createJobForOrder(olOrderId: string, requestId = `order-flow:${olOrderId}`) {
  const { data: o, error } = await db().from('ol_orders').select('*').eq('id', olOrderId).maybeSingle();
  if (error) fromDbError(error);
  if (!o) throw new HttpError(404, 'Order not found', undefined, 'not_found');
  if (o.payment_method !== 'cod' && o.payment_status !== 'paid') throw new HttpError(409, 'This order is not successful yet.', undefined, 'order_not_deliverable');

  const store = o.store_id ? (await db().from('ol_stores').select('*').eq('id', o.store_id).maybeSingle()).data : null;
  const channelQuery = db().from('ol_merchant_channels').select('*');
  const channel = o.organization_id ? (await channelQuery.eq('organization_id', o.organization_id).maybeSingle()).data
    : o.store_id ? (await channelQuery.eq('store_id', o.store_id).maybeSingle()).data : null;

  const address = (o.delivery_address ?? {}) as Row;
  const lines = Array.isArray(o.items) ? (o.items as Row[]) : [];
  const parts = String(address.text ?? '').split(',').map(s => s.trim()).filter(Boolean);
  let name: string | null = null, phone: string | null = null;
  if (o.user_id) {
    try {
      const { data } = await db().auth.admin.getUserById(o.user_id);
      const meta = (data?.user?.user_metadata ?? {}) as Row;
      name = first(meta.full_name ?? meta.name);
      phone = data?.user?.phone ? `+${String(data.user.phone).replace(/^\+/, '')}` : null;
    } catch { /* a name and number are a convenience; the delivery works without them */ }
  }
  const prep = o.prep_minutes ?? channel?.default_prep_minutes ?? null;
  const cod = o.payment_method === 'cod';

  return createJob(parseJobPayload({
    ol_order_id: o.id, pos_order_id: o.pos_order_id ?? null, organization_id: o.organization_id ?? null, store_id: o.store_id ?? null,
    order_no: `OL-${String(o.id).slice(0, 6).toUpperCase()}`,
    payment_mode: cod ? 'cod' : 'online', cash_to_collect: cod ? Number(o.total) : 0,
    items: { count: lines.reduce((n, l) => n + (Number(l.qty) || 1), 0) || 1, temperature: o.organization_id ? 'hot' : 'ambient' },
    prep_minutes: prep, promised_by: new Date(Date.parse(o.created_at) + (Number(o.eta_minutes) || 30) * 60_000).toISOString(),
    // The restaurant's pickup point (channel = the mirror of ol_merchant_locations); the database writes the canonical point onto the job anyway.
    pickup: { name: store?.name ?? 'Store', address: channel?.address ?? null, lat: channel?.lat ?? null, lng: channel?.lng ?? null, phone: null },
    drop: {
      area: address.area ?? address.locality ?? parts[1] ?? parts[0] ?? null, address: address.text ?? null,
      lat: address.lat ?? null, lng: address.lng ?? null, instructions: address.notes ?? null, customer_first_name: name, customer_phone: phone,
    },
  }), requestId);
}

// A restaurant accepted (trigger 'accepted') or rejected the order on the VINII Partner phone.
export async function onRestaurantAccepted(posOrderId: string, prepMinutes: number) {
  if (!dispatchConfigured()) return;
  try {
    const { data: job } = await db().from('delivery_jobs').select('id').eq('pos_order_id', posOrderId).maybeSingle();
    if (job) await releaseJob(job.id, prepMinutes, null, `partner-accept:${posOrderId}`);
  } catch (error) { console.error('[dispatch] release after accept failed', posOrderId, error instanceof HttpError ? error.detail : error); }
}

export async function onRestaurantRejected(posOrderId: string, reason: string) {
  if (!dispatchConfigured()) return;
  try {
    const { data: job } = await db().from('delivery_jobs').select('id').eq('pos_order_id', posOrderId).maybeSingle();
    if (job) await cancelJob(job.id, `restaurant_rejected: ${reason}`.slice(0, 200), null, `partner-reject:${posOrderId}`);
  } catch (error) { console.error('[dispatch] cancel after reject failed', posOrderId, error instanceof HttpError ? error.detail : error); }
}

// ---------- The sweep ----------
// Run every 15-30 seconds by a scheduler (POST /api/dispatch/sweep) and, lightly, by rider heartbeats:
//   1. offers that lapsed move on to the next rider, and a dead pool escalates to operations;
//   2. jobs whose order was cancelled (the restaurant did not answer in time) are cancelled;
//   3. successful orders that never got a job (dispatch was down) get one.
export async function sweep(requestId: string) {
  const out = { advanced: 0, cancelled: 0, created: 0, failed: 0, adopted: 0, refunds_due: 0, refunds_completed: 0, refunds_failed: 0, payments_checked: 0, payments_paid: 0, refunds_polled: 0, pos_online_checked: 0, pos_online_paid: 0 };
  const due = await rpc<string[]>('dispatch_due_jobs', { p_limit: 50 });
  for (const id of due ?? []) { try { await advanceJob(id, requestId); out.advanced++; } catch (e) { out.failed++; console.error('[dispatch] sweep advance', id, e); } }

  const { data: open } = await db().from('delivery_jobs').select('id, ol_order_id').in('status', ['created', 'offered', 'assigned', 'at_pickup']).limit(500);
  if (open?.length) {
    const { data: dead } = await db().from('ol_orders').select('id').in('id', open.map(j => j.ol_order_id)).eq('status', 'cancelled');
    const gone = new Set((dead ?? []).map(o => o.id));
    for (const j of open.filter(j => gone.has(j.ol_order_id))) {
      try { await cancelJob(j.id, 'order_cancelled', null, requestId); out.cancelled++; } catch (e) { out.failed++; console.error('[dispatch] sweep cancel', j.id, e); }
    }
  }

  // Orders that were charged (or placed for cash) but never reached a restaurant: try again, and if still nobody can take one,
  // cancel it and refund it. Then work through the refunds that could not be made when the order was cancelled.
  try {
    const { data: stuck } = await db().from('ol_orders').select('id').eq('status', 'placed').is('pos_order_id', null)
      .or('payment_method.eq.cod,payment_status.eq.paid').lt('created_at', new Date(Date.now() - 2 * 60_000).toISOString())
      .gte('created_at', new Date(Date.now() - 48 * 3_600_000).toISOString()).limit(25);
    if (stuck?.length) out.adopted = (await adoptOrders(stuck.map(o => o.id as string))).length;
    out.refunds_due = (await refundDue()).due;
  } catch (e) { out.failed++; console.error('[dispatch] sweep orders that never reached a restaurant', e instanceof HttpError ? e.detail : e); }

  // The refund queue (0218): refunds queued by a cancel are made at the gateway, retried with backoff, and escalated to operations after 5 attempts.
  try {
    const refunds = await completeQueuedRefunds();
    out.refunds_completed = refunds.completed; out.refunds_failed = refunds.failed;
  } catch (e) { out.failed++; console.error('[dispatch] sweep refund worker', e instanceof HttpError ? e.detail : e); }

  // Cashfree safety net (0238): checkouts still pending after 2 minutes are re-read from Cashfree (a webhook can be lost, and a laptop cannot receive
  // one), and refunds Cashfree accepted but has not settled are asked after. Imported here, not at the top, because cashfree-checkout imports this file.
  try {
    const { sweepCashfreePayments } = await import('./cashfree-checkout');
    const pending = await sweepCashfreePayments();
    out.payments_checked = pending.checked; out.payments_paid = pending.paid;
    const pos = await (await import('./pos-payments')).sweepPosOnlinePayments();
    out.pos_online_checked = pos.checked; out.pos_online_paid = pos.paid;
    const polled = await pollGatewayRefunds();
    out.refunds_polled = polled.checked;
  } catch (e) { out.failed++; console.error('[dispatch] sweep Cashfree payments and refunds', e instanceof HttpError ? e.detail : e); }

  // The outbox: deliver the events the database queued (order.transitioned pushes) and mark them published.
  let outbox: Awaited<ReturnType<typeof publishOutbox>> | null = null;
  try { outbox = await publishOutbox(); } catch (e) { out.failed++; console.error('[dispatch] sweep outbox', e instanceof HttpError ? e.detail : e); }

  const { data: missing } = await db().from('delivery_orders_needing_rider').select('ol_order_id').limit(20);
  for (const m of missing ?? []) {
    try { await createJobForOrder(m.ol_order_id, requestId); out.created++; }
    catch (e) {
      out.failed++;
      // A problem that does not heal itself (no map location for the store) is logged once, not on every sweep.
      if (!reported.has(m.ol_order_id)) { reported.add(m.ol_order_id); console.error('[dispatch] sweep cannot create a job for', m.ol_order_id, e instanceof HttpError ? e.detail : e); }
    }
  }
  return { ...out, outbox };
}

// Cheap enough to run on rider heartbeats: keeps offers moving while any rider is online, even with no scheduler.
let lastAdvance = 0;
export async function advanceDue(requestId: string, minGapMs = 10_000) {
  if (Date.now() - lastAdvance < minGapMs) return;
  lastAdvance = Date.now();
  try {
    const due = await rpc<string[]>('dispatch_due_jobs', { p_limit: 10 });
    for (const id of due ?? []) await advanceJob(id, requestId);
  } catch (error) { console.warn('[dispatch] advanceDue', error instanceof HttpError ? error.detail : error); }
}
