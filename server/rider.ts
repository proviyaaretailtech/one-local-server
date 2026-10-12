// The rider's side of dispatch: who is calling, going online, the live offer, answering it.
// Routes: /api/rider/* (docs/RIDER_APP_E2E_V1.md section 5). Only the pool-and-offer half exists so far;
// onboarding, the job steps after assignment, proof and money are separate pieces of work.
// A rider is a login (Supabase phone OTP) with an approved row in `riders` (D2).
import { distanceKm, serviceability } from './catalog';
import { advanceDue, advanceJob, displayState, riderJob, verifyDeliveryCode } from './dispatch';
import { db, fromDbError, rpc } from './db';
import { HttpError, sha256 } from './http';
import { signedInUserId } from './auth';
import { confirmJobAsset } from './rider-extra';

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Rider = { id: string; userId: string; name: string; type: string; organizationId: string | null; acceptance?: string };

export async function requireRider(request: Request): Promise<Rider> {
  const userId = await signedInUserId(request);
  if (!userId) throw new HttpError(401, 'Sign in to continue.');
  const { data, error } = await db().from('riders').select('id, full_name, type, status, organization_id, acceptance').eq('user_id', userId).maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw new HttpError(403, 'You are not registered as a rider yet.', undefined, 'not_enrolled');
  if (data.status === 'suspended') throw new HttpError(403, 'Your rider account is suspended. Please contact support.', undefined, 'suspended');
  if (data.status !== 'approved') throw new HttpError(403, 'Your rider application is not approved yet.', undefined, 'not_enrolled'); // the app's own code: a rider who is not approved yet belongs in onboarding
  return { id: data.id, userId, name: data.full_name, type: data.type, organizationId: data.organization_id, acceptance: data.acceptance };
}

const point = (b: Row) => {
  const lat = b.lat, lng = b.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpError(400, 'Send your location (lat and lng).', undefined, 'validation');
  }
  return { lat, lng };
};
const small = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null);

// POST /rider/availability. Going online needs a position inside the delivery area.
export async function setAvailability(rider: Rider, b: Row) {
  if (typeof b.online !== 'boolean') throw new HttpError(400, 'Say whether you are going online.', undefined, 'validation');
  const row: Row = { rider_id: rider.id, online: b.online, last_seen_at: new Date().toISOString() };
  if (b.online) {
    const here = point(b);
    if (!serviceability(here).serviceable) throw new HttpError(422, 'You are outside the delivery area.', undefined, 'out_of_zone');
    Object.assign(row, here, { accuracy_m: small(b.accuracy_m, 0, 100_000) });
  }
  const { error } = await db().from('rider_availability').upsert(row, { onConflict: 'rider_id' });
  if (error) fromDbError(error);
  // A job may have been waiting for exactly this rider.
  if (b.online) await advanceDue(`online:${rider.id}`, 0);
  return { online: b.online };
}

// POST /rider/heartbeat, every 30 seconds while online. A rider silent for 60 seconds counts as offline.
export async function heartbeat(rider: Rider, b: Row) {
  const here = point(b);
  const { data, error } = await db().from('rider_availability').update({
    ...here, accuracy_m: small(b.accuracy_m, 0, 100_000), battery: small(b.battery, 0, 100), last_seen_at: new Date().toISOString(),
  }).eq('rider_id', rider.id).eq('online', true).select('rider_id');
  if (error) fromDbError(error);
  // Heartbeats double as the dispatch clock while no scheduler is running.
  await advanceDue(`heartbeat:${rider.id}`);
  return { ok: true, online: !!data?.length, server_time: new Date().toISOString() };
}

export async function registerPushToken(rider: Rider, b: Row) {
  const token = String(b.expo_push_token ?? '');
  if (!/^Expo(nent)?PushToken\[[^\]]{4,200}\]$/.test(token)) throw new HttpError(400, 'Invalid device registration.', undefined, 'validation');
  if (b.platform !== 'ios' && b.platform !== 'android') throw new HttpError(400, 'Invalid device registration.', undefined, 'validation');
  const { error } = await db().from('push_tokens').upsert(
    { rider_id: rider.id, expo_push_token: token, platform: b.platform, last_ok_at: new Date().toISOString() }, { onConflict: 'expo_push_token' });
  if (error) fromDbError(error);
  return { ok: true };
}

async function position(riderId: string) {
  const { data } = await db().from('rider_availability').select('lat, lng').eq('rider_id', riderId).maybeSingle();
  return data?.lat != null && data?.lng != null ? { lat: data.lat as number, lng: data.lng as number } : null;
}

// GET /rider/offers/current: the live offer with the seconds left, or null (the route answers 204).
// An offer that lapsed is moved on here too, so a rider opening the app never sees a dead card.
export async function currentOffer(rider: Rider) {
  const { data: offer, error } = await db().from('delivery_assignments').select('*').eq('rider_id', rider.id).is('outcome', null).maybeSingle();
  if (error) fromDbError(error);
  if (!offer) return null;
  if (Date.parse(offer.expires_at) <= Date.now()) {
    await advanceJob(offer.job_id, `offer-read:${rider.id}`);
    return null;
  }
  const { data: job } = await db().from('delivery_jobs').select('*').eq('id', offer.job_id).maybeSingle();
  if (!job) return null;
  const here = await position(rider.id);
  const view = await jobDto(job, here);
  return {
    offer_id: offer.id, round: offer.round, mode: rider.acceptance === 'auto' ? 'auto' : 'manual', expires_at: offer.expires_at,
    offered_at: offer.offered_at ?? null, surge_multiplier: 1,
    seconds_left: Math.max(0, Math.round((Date.parse(offer.expires_at) - Date.now()) / 1000)),
    job: view, payout_estimate: view.payout_estimate,
    pickup: { name: job.pickup_name, area: view.pickup.area, distance_km: here ? Math.round(distanceKm(here, { lat: job.pickup_lat, lng: job.pickup_lng }) * 10) / 10 : 0 },
    drop: { area: job.drop_area, distance_km: view.distance_km },
    eta_min: view.eta.to_pickup_min, note: job.temperature === 'hot' ? 'Hot food: keep it upright and go straight to the customer.' : null,
  };
}

function offerId(id: string) {
  if (!UUID.test(id)) throw new HttpError(404, 'Offer not found', undefined, 'not_found');
  return id;
}

// POST /rider/offers/:id/accept. The first to answer wins; everyone else gets already_taken.
export async function acceptOffer(rider: Rider, id: string) {
  const result = await rpc<{ job_id: string }>('dispatch_answer', { p_assignment: offerId(id), p_rider: rider.id, p_accept: true, p_reason: null, p_request_id: `accept:${id}` }).catch(e => { throw alignCode(e); });
  return jobForRider(rider, result.job_id);
}

// POST /rider/offers/:id/decline. The next rider is offered the job straight away.
export async function declineOffer(rider: Rider, id: string, b: Row) {
  const reason = typeof b.reason === 'string' ? b.reason.slice(0, 200) : null;
  const result = await rpc<{ job_id: string }>('dispatch_answer', { p_assignment: offerId(id), p_rider: rider.id, p_accept: false, p_reason: reason, p_request_id: `decline:${id}` }).catch(e => { throw alignCode(e); });
  await advanceJob(result.job_id, `decline:${id}`);
  return { ok: true };
}

export async function jobForRider(rider: Rider, jobId: string) {
  if (!UUID.test(jobId)) throw new HttpError(404, 'Job not found', undefined, 'not_found');
  // A rider sees only their own jobs: the filter is the permission.
  const { data, error } = await db().from('delivery_jobs').select('*').eq('id', jobId).eq('rider_id', rider.id).maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw new HttpError(404, 'Job not found', undefined, 'not_found');
  return jobDto(data, await position(rider.id));
}

export async function currentJob(rider: Rider) {
  const { data, error } = await db().from('delivery_jobs').select('*').eq('rider_id', rider.id)
    .in('status', ['assigned', 'at_pickup', 'picked_up', 'at_drop', 'exception']).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) fromDbError(error);
  return data ? jobDto(data, await position(rider.id)) : null;
}

// What counts as proof of delivery for a job. This one list is what the app is shown (JobDto.proof_methods) AND what submitProof
// enforces: a method that is not here is refused, and a method that is here must bring its own evidence (the right code, or an
// uploaded photo/signature that belongs to this job). After five wrong codes the code is out and the others remain.
const otpLocked = (job: Row) => (job.otp_attempts ?? 0) >= 5;
export const proofMethods = (job: Row): string[] => (otpLocked(job) ? ['photo', 'signature'] : ['otp', 'photo', 'signature']);

// How far from the drop pin a proof may be given (SRV-1). The contract flags a proof beyond 300 m; the server now refuses it instead:
// a delivery cannot be completed from somewhere else. A rider who cannot get that close (a gate, a bad fix) reports a problem.
// PROOF_MAX_DISTANCE_M can widen or narrow it, between 50 m and 1 km.
const proofRadiusM = () => Math.min(1000, Math.max(50, Number(process.env.PROOF_MAX_DISTANCE_M) || 300));
// A reason typed at pickup excuses a poor GPS fix, not being somewhere else: beyond this the reason does not count (the database then
// applies its own 150 m rule, which has no excuse).
const PICKUP_REASON_MAX_M = 500;

// ---------- The job as the Rider app's JobDto (src/api/dto.ts) ----------
// `state` is the app's fifteen-state vocabulary (created, offered, accepted, to_pickup, at_pickup, pickup_verified, picked_up,
// to_drop, at_drop, handover, proof, delivered, failed, returned, cancelled); `status`, `step` and `display_state` stay for older callers.
const SPEED_KMH = 20;
const minutes = (km: number) => Math.max(1, Math.ceil((km / SPEED_KMH) * 60));
const rupees = (minor: number | string | null | undefined) => (minor == null ? null : Number(minor) / 100);

// A job held for a problem shows the state it was in before the problem; the open problem is in `flags` and `exception`.
export function appState(job: Row): string {
  if (job.status === 'exception' && !['failed', 'returned'].includes(job.step)) {
    return displayState({ status: job.exception_from_status, step: job.exception_from_step });
  }
  return displayState(job);
}

// The rider's pay for this job in rupees, from the city's rate card. null when there is no rate card: pay is never invented.
async function payoutFor(jobId: string): Promise<number | null> {
  const { data, error } = await db().rpc('rider_job_pay_minor', { p_job: jobId });
  return error || data == null ? null : rupees(data as number);
}

async function itemsOf(olOrderId: string | null) {
  if (!olOrderId) return [];
  const { data } = await db().from('ol_order_items').select('id, name, qty').eq('order_id', olOrderId).order('created_at');
  return (data ?? []).map((i: Row) => ({ id: String(i.id), name: String(i.name ?? ''), qty: Number(i.qty ?? 1) }));
}

// "Shop 4, Station Road, Latur" -> "Station Road": the neighbourhood, never the door.
const areaOf = (address: unknown) => {
  const parts = String(address ?? '').split(',').map(p => p.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 2] : parts[0] ?? '';
};

export async function jobDto(job: Row, here?: { lat: number; lng: number } | null) {
  const base = riderJob(job, here);
  const [payout, items] = await Promise.all([payoutFor(job.id), itemsOf(job.ol_order_id)]);
  const state = appState(job);
  const pickupPoint = { lat: job.pickup_lat, lng: job.pickup_lng };
  const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => distanceKm(a, b);
  const beforePickup = ['created', 'offered', 'accepted', 'to_pickup', 'at_pickup', 'pickup_verified'].includes(state);
  const dropPoint = { lat: job.drop_lat, lng: job.drop_lng };
  // The app reads both numbers, so both are always numbers. Without a position yet, the time to the store counts as 0.
  const eta = {
    to_pickup_min: beforePickup && here ? minutes(km(here, pickupPoint)) : 0,
    to_drop_min: minutes(km(!beforePickup && here ? here : pickupPoint, dropPoint)),
  };
  const locked = otpLocked(job);
  return {
    ...base,
    state, city_id: job.city_id, pickup_zone: job.city_id, drop_zone: job.city_id,
    pickup: { ...base.pickup, area: areaOf(job.pickup_address), phone_masked: true, store_id: job.store_id ?? undefined },
    drop: { ...base.drop, customer_first_name: base.drop.customer_first_name || 'Customer' }, // the app needs a name to show; an order with no name on file reads "Customer"
    items, proof_methods: proofMethods(job),
    payout_estimate: payout, surge_multiplier: 1, eta,
    pickup_distance_km: here ? Math.round(km(here, pickupPoint) * 10) / 10 : undefined,
    deadlines: { drop_by: job.promised_by ?? undefined },
    otp_attempts: job.otp_attempts ?? 0, otp_locked: locked, otp_digits: job.otp_digits ?? 4,
    rider_id: job.rider_id ?? undefined, delivered_at: job.delivered_at ?? undefined,
    created_at: job.created_at, updated_at: job.updated_at,
    flags: job.status === 'exception' ? ['exception', ...(job.exception_kind ? [`exception:${job.exception_kind}`] : [])] : [],
  };
}

// ---------- After assignment: steps, pickup check, proof, problems ----------
// Contract: docs/ONE_LOCAL_RIDER_BACKEND_CONTRACT.md section 5. Each command is one database function (0030): it checks the
// rider owns the job and the version, replays safely on the same Idempotency-Key, and writes its event in the same transaction.
const STEPS = ['to_pickup', 'at_pickup', 'picked_up', 'to_drop', 'at_drop', 'handover', 'proof'];
const PROBLEMS = ['not_ready', 'mismatch', 'incomplete', 'vehicle', 'safety', 'unavailable', 'address', 'refused', 'other'];
// The app also has proof_failed and cannot_access. dispatch_raise_exception only takes the nine kinds above (the table would take proof_failed,
// the function guards it), so they travel as the nearest kind with the app's kind kept at the start of the note.
const APP_ONLY: Record<string, string> = { proof_failed: 'other', cannot_access: 'address' };

export type Command = { key: string; hash: string; requestId: string };
// The key says "this is the same tap"; the hash says "and the same request".
export async function commandOf(request: Request, body: Row): Promise<Command> {
  const key = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!/^[\w:.-]{8,200}$/.test(key)) throw new HttpError(400, 'Idempotency-Key is required.', undefined, 'validation');
  const canonical = JSON.stringify(Object.keys(body).sort().map(k => [k, body[k]]));
  return { key, hash: await sha256(canonical), requestId: request.headers.get('x-request-id')?.trim() || `rider:${key}` };
}

const bad = (detail: string) => new HttpError(400, detail, undefined, 'validation');
const version = (b: Row) => { if (!Number.isInteger(b.version)) throw bad('Send the version of the job you saw.'); return b.version as number; };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// A time the app says an action happened (offline queue). Nothing older than 12 hours is believed (the database already clamps the
// future), so a rider cannot backdate a step; an older one is replaced by the server's own time.
const when = (v: unknown) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) && t > Date.now() - 12 * 3_600_000 ? new Date(t).toISOString() : null; };
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const place = (b: Row) => ({ lat: num(b.lat), lng: num(b.lng) });

// A stale version tells the rider what the server has, so the app can replace its copy and carry on.
// The app's error vocabulary (httpClient KNOWN_CODES) is the contract: the server's finer codes are folded into it, the original
// kept in `reason`. A step the job can no longer take means the app's copy is stale, which is a version conflict to the app.
const STALE = ['version_conflict', 'invalid_transition', 'wrong_state'];
const APP_CODE: Record<string, string> = { cash_mismatch: 'validation', offer_withdrawn: 'offer_expired' };
async function conflict<T>(rider: Rider, jobId: string, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (error instanceof HttpError && error.code && STALE.includes(error.code)) {
      const job = await jobForRider(rider, jobId);
      throw Object.assign(new HttpError(409, error.detail, undefined, 'version_conflict'), { extra: { server_version: job.version, status: job.status, step: job.step, job, reason: error.code } });
    }
    throw alignCode(error);
  }
}
function alignCode(error: unknown) {
  if (error instanceof HttpError && error.code && APP_CODE[error.code]) {
    return Object.assign(new HttpError(error.status, error.detail, error.headers, APP_CODE[error.code]), { extra: { ...error.extra, reason: error.code } });
  }
  return error;
}

// POST /rider/jobs/:id/step
export async function stepJob(rider: Rider, jobId: string, b: Row, cmd: Command) {
  if (!UUID.test(jobId)) throw new HttpError(404, 'Job not found', undefined, 'not_found');
  if (typeof b.to !== 'string' || !STEPS.includes(b.to)) throw bad(`to must be one of ${STEPS.join(', ')}`);
  const { lat, lng } = place(b);
  let reason = text(b.reason, 200);
  if (b.to === 'at_pickup' && reason) {
    const { data: job, error } = await db().from('delivery_jobs').select('pickup_lat, pickup_lng').eq('id', jobId).eq('rider_id', rider.id).maybeSingle();
    if (error) fromDbError(error);
    const near = !!job && lat != null && lng != null && job.pickup_lat != null && job.pickup_lng != null && distanceKm({ lat, lng }, { lat: job.pickup_lat, lng: job.pickup_lng }) * 1000 <= PICKUP_REASON_MAX_M;
    if (!near) reason = null;
  }
  const r = await conflict(rider, jobId, () => rpc<Row>('dispatch_step', {
    p_job: jobId, p_rider: rider.id, p_to: b.to, p_expected: version(b), p_key: cmd.key, p_hash: cmd.hash, p_lat: lat, p_lng: lng,
    p_accuracy: num(b.accuracy_m), p_recorded_at: when(b.recorded_at), p_reason: reason, p_request_id: cmd.requestId }));
  return reply(rider, jobId, r);
}

// POST /rider/jobs/:id/pickup-verify
export async function verifyPickup(rider: Rider, jobId: string, b: Row, cmd: Command) {
  if (!UUID.test(jobId)) throw new HttpError(404, 'Job not found', undefined, 'not_found');
  const r = await conflict(rider, jobId, () => rpc<Row>('dispatch_verify_pickup', {
    p_job: jobId, p_rider: rider.id, p_expected: version(b), p_key: cmd.key, p_hash: cmd.hash, p_items_ok: b.items_ok === true,
    p_recorded_at: when(b.recorded_at), p_request_id: cmd.requestId }));
  return reply(rider, jobId, r);
}

// POST /rider/jobs/:id/proof. What the server checks BEFORE the database function records the delivery (SRV-1):
//   1. the method is one of the job's proof_methods and brings its own evidence: the delivery code, or an uploaded photo/signature that is
//      this rider's, the right kind, really in storage, made for this job and not used before (confirmJobAsset);
//   2. the rider is at the door: the position sent must be within the drop radius of the drop pin. A job that has a drop location cannot be
//      completed from anywhere else;
//   3. the code is compared with the job's stored verifier in constant time. The database still counts every miss (five wrong codes lock
//      the job and raise a problem for operations), so what it is handed is the stored verifier on a match and the typed code's hash otherwise.
export async function submitProof(rider: Rider, jobId: string, b: Row, cmd: Command) {
  if (!UUID.test(jobId)) throw new HttpError(404, 'Job not found', undefined, 'not_found');
  const method = String(b.method ?? '');
  if (!['otp', 'photo', 'signature'].includes(method)) throw bad('method must be otp, photo or signature');
  const code = typeof b.code === 'string' && /^(\d{6}|\d{4})$/.test(b.code) ? b.code : null; // 6 digits; 4 only for a job created before the 6-digit code (checked per job)
  if (method === 'otp' && !code) throw bad('The delivery code is 6 digits.');
  if (method !== 'otp' && !(typeof b.asset_id === 'string' && UUID.test(b.asset_id))) throw bad('Send the photo or signature (asset_id).');
  const { data: job, error: jobError } = await db().from('delivery_jobs').select('*').eq('id', jobId).eq('rider_id', rider.id).maybeSingle();
  if (jobError) fromDbError(jobError);
  if (!job) throw new HttpError(404, 'Job not found', undefined, 'not_found');
  const { lat, lng } = place(b);
  if (lat === null || lng === null) throw bad('Send your location (lat and lng).');

  // The checks below guard a FIRST try. A repeat of a command the database already stored (same Idempotency-Key: a retry after a lost
  // answer, even though its photo is by now attached to the delivered proof) is answered by the database from its stored reply, and a
  // job that is already closed or held for a problem is refused by the database on its own, so those skip the checks. Every other job is
  // checked whatever state it is read in: a rider who fires a step and a proof together cannot slip the proof past the checks.
  const { data: stored, error: storedError } = await db().from('delivery_commands').select('job_id').eq('job_id', jobId).eq('idempotency_key', cmd.key).maybeSingle();
  if (storedError) fromDbError(storedError);
  let asset: string | null = null, checked: { ok: boolean; hash: string } | null = null;
  if (!stored && !['delivered', 'cancelled', 'exception'].includes(job.status)) {
    if (method === 'otp' && otpLocked(job)) throw Object.assign(new HttpError(423, 'Too many wrong codes. Operations has been told.', undefined, 'otp_locked'), { extra: { job: await jobForRider(rider, jobId) } });
    if (!proofMethods(job).includes(method)) throw bad(`This delivery takes ${proofMethods(job).join(', ')} as proof.`);
    if (job.drop_lat != null && job.drop_lng != null) {
      const metres = Math.round(distanceKm({ lat, lng }, { lat: job.drop_lat, lng: job.drop_lng }) * 1000);
      if (metres > proofRadiusM()) {
        throw Object.assign(new HttpError(422, `You are ${metres} m from the drop point. Hand over at the door, or report a problem if you cannot get closer.`, undefined, 'too_far'), { extra: { distance_m: metres, max_m: proofRadiusM() } });
      }
    }
    if (method !== 'otp') asset = await confirmJobAsset(rider, job, b.asset_id as string, [method === 'photo' ? 'proof_photo' : 'proof_signature'], 'proof');
  }
  if (code) checked = await verifyDeliveryCode(job as { ol_order_id: string; otp_hash: string | null }, code);
  const r = await conflict(rider, jobId, () => rpc<Row>('dispatch_submit_proof', {
    p_job: jobId, p_rider: rider.id, p_expected: version(b), p_key: cmd.key, p_hash: cmd.hash, p_method: method,
    p_code_hash: checked?.hash ?? null, p_asset: asset ?? (stored && typeof b.asset_id === 'string' && UUID.test(b.asset_id) ? b.asset_id : null), p_lat: lat, p_lng: lng,
    p_cash: num(b.cash_collected), p_recorded_at: when(b.recorded_at), p_request_id: cmd.requestId }));
  if (r.result === 'otp_invalid') throw Object.assign(new HttpError(422, 'That code is not right.', undefined, 'otp_invalid'), { extra: { attempts_left: r.attempts_left } });
  if (r.result === 'otp_locked') throw Object.assign(new HttpError(423, 'Too many wrong codes. Operations has been told.', undefined, 'otp_locked'), { extra: { job: await jobForRider(rider, jobId) } });
  // The app reads {job, earnings, flagged, distance_from_drop_m}; the job's own fields stay at the top level for older callers.
  const view = await reply(rider, jobId, r);
  const [earnings, { data: proof }] = await Promise.all([
    jobEarnings(rider, jobId, view),
    db().from('delivery_proofs').select('distance_m').eq('job_id', jobId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  return { ...view, job: view, earnings, cash_collected: r.cash_collected ?? null, flagged: !!r.flagged, distance_from_drop_m: proof?.distance_m ?? undefined };
}

// The app's JobEarningsDto from what was actually credited (rider_earnings, minor units -> rupees). No rate card means nothing was
// credited and every figure is 0: pay is never invented.
async function jobEarnings(rider: Rider, jobId: string, view: { distance_km: number; created_at: string }) {
  const { data } = await db().from('rider_earnings').select('kind, amount_minor, created_at').eq('rider_id', rider.id).eq('delivery_job_id', jobId);
  const sum = (kind: string) => (data ?? []).filter((e: Row) => e.kind === kind).reduce((n: number, e: Row) => n + Number(e.amount_minor), 0) / 100;
  const base = sum('delivery_fee'), tip = sum('tip'), bonus = sum('bonus');
  return {
    job_id: jobId, base, distance: 0, peak: 0, wait: 0, tip, bonus, total: base + tip + bonus, rule_version: 1,
    distance_km: view.distance_km, created_at: data?.[0]?.created_at ?? new Date().toISOString(),
  };
}

// GET /rider/jobs/:id?detail=true -> {job, events, proof, pickup_check, earnings} (the app's JobDetail; events, proof and pickup_check are
// read straight into the app's types, so they are camelCase).
const EVENT_STATE: Record<string, string> = {
  assigned: 'accepted', to_pickup: 'to_pickup', at_pickup: 'at_pickup', pickup_verified: 'pickup_verified', picked_up: 'picked_up',
  to_drop: 'to_drop', at_drop: 'at_drop', handover: 'handover', proof_requested: 'proof', delivered: 'delivered', cancelled: 'cancelled',
};
export async function jobDetail(rider: Rider, jobId: string) {
  const job = await jobForRider(rider, jobId);
  const [{ data: events }, { data: proof }] = await Promise.all([
    db().from('delivery_events').select('id, kind, meta, created_at').eq('job_id', jobId).order('id'),
    db().from('delivery_proofs').select('method, distance_m, recorded_at, created_at').eq('job_id', jobId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  let prev: string | undefined;
  const timeline: Row[] = [];
  for (const e of events ?? []) {
    const name = String(e.kind).replace(/^delivery\./, '');
    const m = (e.meta ?? {}) as Row;
    const to = name === 'exception' ? displayState({ status: m.from_status, step: m.from_step }) : EVENT_STATE[name];
    if (!to) continue; // offers to other riders, timeouts and the like are not the rider's history
    timeline.push({
      id: String(e.id), jobId, fromState: prev, toState: to, actor: m.actor === 'rider' ? 'rider' : m.actor === 'ops' || m.actor === 'operations' ? 'operations' : 'server',
      reason: name === 'exception' ? m.exception_kind : m.reason ?? undefined, createdAt: m.recorded_at ?? e.created_at,
    });
    prev = to;
  }
  const checked = (events ?? []).find((e: Row) => e.kind === 'delivery.pickup_verified');
  return {
    job, events: timeline,
    proof: proof ? { method: proof.method, createdAt: proof.recorded_at ?? proof.created_at, distanceFromDropM: proof.distance_m ?? undefined } : undefined,
    // The database keeps that the check passed, not how it was done.
    pickup_check: checked ? { method: 'scan', result: 'verified', checkedAt: checked.meta?.recorded_at ?? checked.created_at } : undefined,
    earnings: job.status === 'delivered' ? await jobEarnings(rider, jobId, job) : undefined,
  };
}

// POST /rider/jobs/:id/pickup/verify, the app's contract: {method: scan|code|typed|bypass, code, items:[{id, ok}], reason, version}
// -> {result: verified|mismatch|incomplete, expected_sku?, scanned?, missing?, job}. Mismatch and incomplete are answers, not errors,
// and change nothing; only a verified check moves the job (one database function, same as pickup-verify).
const norm = (v: unknown) => String(v ?? '').trim().replace(/^#/, '').toLowerCase();
export async function verifyPickupApp(rider: Rider, jobId: string, b: Row, cmd: Command) {
  if (!UUID.test(jobId)) throw new HttpError(404, 'Job not found', undefined, 'not_found');
  const method = String(b.method ?? '');
  if (!['scan', 'code', 'typed', 'bypass'].includes(method)) throw bad('method must be scan, code, typed or bypass');
  const expected = version(b);
  const { data: job } = await db().from('delivery_jobs').select('ol_order_id, order_no, kitchen_no').eq('id', jobId).eq('rider_id', rider.id).maybeSingle();
  if (!job) throw new HttpError(404, 'Job not found', undefined, 'not_found');
  const answer = async (extra: Row) => ({ ...extra, job: await jobForRider(rider, jobId) });

  if (method === 'bypass') { if (!text(b.reason, 200)) throw bad('Say why the check is skipped.'); }
  else {
    const code = text(b.code, 100);
    if (!code) throw bad('Send the code from the bag.');
    const known = [job.order_no, job.kitchen_no].filter(Boolean).map(norm);
    if (known.length && !known.includes(norm(code))) return answer({ result: 'mismatch', expected_sku: job.order_no ?? job.kitchen_no, scanned: code });
  }
  if (Array.isArray(b.items)) {
    const bad_ = new Set(b.items.filter((i: Row) => i && i.ok === false).map((i: Row) => String(i.id)));
    if (bad_.size) {
      const all = await itemsOf(job.ol_order_id);
      return answer({ result: 'incomplete', missing: all.filter(i => bad_.has(i.id)) });
    }
  }
  const r = await conflict(rider, jobId, () => rpc<Row>('dispatch_verify_pickup', {
    p_job: jobId, p_rider: rider.id, p_expected: expected, p_key: cmd.key, p_hash: cmd.hash, p_items_ok: true,
    p_recorded_at: when(b.recorded_at), p_request_id: cmd.requestId }));
  return { result: 'verified', job: await jobForRider(rider, jobId), replayed: !!r.replayed };
}

// POST /rider/jobs/:id/exception
export async function reportProblem(rider: Rider, jobId: string, b: Row, cmd: Command) {
  if (!UUID.test(jobId)) throw new HttpError(404, 'Job not found', undefined, 'not_found');
  if (typeof b.kind !== 'string' || !(PROBLEMS.includes(b.kind) || b.kind in APP_ONLY)) throw bad(`kind must be one of ${[...PROBLEMS, ...Object.keys(APP_ONLY)].join(', ')}`);
  const { lat, lng } = place(b);
  const kind = b.kind as string, dbKind = APP_ONLY[kind] ?? kind;
  const note = APP_ONLY[kind] ? text(`[${kind}] ${text(b.note, 480) ?? ''}`, 500) : text(b.note, 500);
  // A photo sent with a problem is held to the same rules as a proof photo: the rider's own file, really uploaded, for this job, used once.
  let asset: string | null = null;
  if (b.asset_id != null) {
    if (typeof b.asset_id !== 'string' || !UUID.test(b.asset_id)) throw bad('asset_id: not a valid file');
    const { data: job, error } = await db().from('delivery_jobs').select('*').eq('id', jobId).eq('rider_id', rider.id).maybeSingle();
    if (error) fromDbError(error);
    if (!job) throw new HttpError(404, 'Job not found', undefined, 'not_found');
    // A repeat of a command the database already stored is answered from its stored reply (its photo is by now attached to the problem).
    const { data: stored, error: storedError } = await db().from('delivery_commands').select('job_id').eq('job_id', jobId).eq('idempotency_key', cmd.key).maybeSingle();
    if (storedError) fromDbError(storedError);
    asset = stored ? b.asset_id : await confirmJobAsset(rider, job, b.asset_id, ['exception_photo'], 'problem');
  }
  const r = await conflict(rider, jobId, () => rpc<Row>('dispatch_raise_exception', {
    p_job: jobId, p_rider: rider.id, p_expected: version(b), p_key: cmd.key, p_hash: cmd.hash, p_kind: dbKind, p_note: note,
    p_asset: asset, p_lat: lat, p_lng: lng,
    p_clat: num(b.corrected_lat), p_clng: num(b.corrected_lng), p_request_id: cmd.requestId }));
  const view = await reply(rider, jobId, r);
  // The app reads {exception, jobState, nextActions, waitSeconds, message} (camelCase). The job's own fields and the older
  // exception_id / next_actions stay at the top level for older callers.
  return {
    ...view, exception_id: r.exception_id, next_actions: NEXT_AFTER[dbKind] ?? ['wait_for_operations'],
    exception: { id: r.exception_id, jobId, kind, note: text(b.note, 500) ?? undefined, status: 'open', createdAt: new Date().toISOString(), closed: false },
    jobState: view.state, nextActions: APP_NEXT[kind] ?? ['await_operations'],
    waitSeconds: WAIT_SECONDS[kind], message: APP_MESSAGE[kind] ?? 'Operations has been told and will sort this out.',
  };
}

// The same advice in the app's own words (ExceptionNextAction).
const APP_NEXT: Record<string, string[]> = {
  not_ready: ['wait', 'call_merchant'], mismatch: ['call_merchant', 'await_operations'], incomplete: ['call_merchant', 'await_operations'],
  vehicle: ['await_operations'], safety: ['escalate', 'await_operations'], unavailable: ['call_customer', 'wait'],
  address: ['call_customer', 'share_location'], cannot_access: ['call_customer', 'wait'], refused: ['return_to_store'],
  proof_failed: ['photo_fallback', 'call_customer'], other: ['await_operations'],
};
const WAIT_SECONDS: Record<string, number | undefined> = { not_ready: 300, unavailable: 300, cannot_access: 300 };
const APP_MESSAGE: Record<string, string> = {
  not_ready: 'Wait a few minutes, or call the restaurant.', unavailable: 'Call the customer and wait a few minutes.',
  safety: 'Operations has been alerted. Stay safe.', refused: 'Return the order to the restaurant.',
  proof_failed: 'Call the customer, or hand over with a photo instead.',
};

// What the rider is told to do while operations looks at the problem (contract 5.5).
const NEXT_AFTER: Record<string, string[]> = {
  not_ready: ['wait', 'call_store'], mismatch: ['call_store', 'wait_for_operations'], incomplete: ['call_store', 'wait_for_operations'],
  vehicle: ['request_reassignment'], safety: ['call_helpline', 'wait_for_operations'], unavailable: ['call_customer', 'wait'],
  address: ['call_customer', 'wait'], refused: ['return_to_store'], other: ['wait_for_operations'],
};

// The job as the rider sees it now, plus whether this answer was a replay.
async function reply(rider: Rider, jobId: string, r: Row) {
  return { ...(await jobForRider(rider, jobId)), replayed: !!r.replayed };
}
