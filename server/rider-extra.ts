// The rider's extra routes: GPS tracks, file uploads, waiting problems, SOS, calling the customer, delivery-code
// resend and the notification inbox. The core delivery routes (step, proof, ...) live in rider.ts.
// Contract: docs/ONE_LOCAL_RIDER_BACKEND_CONTRACT.md, Rider app src/providers/oneLocalApiProvider.ts.
// A rider is always identified from the token (requireRider); an id in a URL or body is only ever looked up
// together with that rider's id, so another rider's rows are simply "not found".
import { z } from 'zod';
import { distanceKm } from './catalog';
import { db, fromDbError, rpc } from './db';
import { displayState } from './dispatch';
import { HttpError } from './http';
import { pushToRider } from './push';

type Row = Record<string, any>;
// Anyone with a rider row: approved riders for the delivery routes, applicants for uploads.
type Who = { id: string };
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE = ['assigned', 'at_pickup', 'picked_up', 'at_drop', 'exception'];

// ---------- helpers shared by rider-money.ts and rider-onboarding.ts ----------

// Validates with zod. The message names the field, never the value (values can be personal data).
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
  throw new HttpError(400, `${where}${issue?.message ?? 'Invalid request'}`.slice(0, 200), undefined, 'validation');
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`, undefined, 'not_found');
export function uuidParam(id: string, what: string) {
  if (!UUID.test(id)) throw notFound(what);
  return id;
}

// Idempotency-Key: "this is the same tap". Same shape rule as the delivery commands in rider.ts.
export function idemKey(request: Request, required = true): string | null {
  const key = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!key && !required) return null;
  if (!/^[\w:.-]{8,200}$/.test(key)) throw new HttpError(400, 'Idempotency-Key is required.', undefined, 'invalid_request');
  return key;
}

const EXPONENT: Record<string, number> = { JPY: 0, KRW: 0, VND: 0, BHD: 3, KWD: 3, OMR: 3 };
const exp = (c: string) => EXPONENT[c] ?? 2;
// The database keeps integer minor units (paise); the apps show major units (rupees).
export const fromMinor = (minor: number | string | null | undefined, currency = 'INR') =>
  Math.round(Number(minor ?? 0)) / 10 ** exp(currency);
export const toMinor = (major: number, currency = 'INR') => Math.round(major * 10 ** exp(currency));

// Keyset pagination on (created_at desc, id desc). The cursor is opaque to the app.
export type Cursor = { t: string; id: string };
export const encodeCursor = (row: { created_at: string; id: string | number }) =>
  Buffer.from(JSON.stringify([row.created_at, String(row.id)])).toString('base64url');
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const [t, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof t !== 'string' || !/^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)$/.test(t) || !Number.isFinite(Date.parse(t))) throw new Error();
    if (typeof id !== 'string' || !/^[0-9a-f-]{1,40}$/i.test(id)) throw new Error();
    return { t, id };
  } catch { throw new HttpError(400, 'That page cursor is not valid.', undefined, 'validation'); }
}
export const afterCursor = (c: Cursor) => `created_at.lt.${c.t},and(created_at.eq.${c.t},id.lt.${c.id})`;
export const PAGE = 30;

// ---------- policy numbers, per city ----------

export type RiderPolicy = { withdrawMinMinor: number; withdrawMaxMinor: number; withdrawPerDay: number; defaultCashLimitMinor: number; unavailableWaitSeconds: number };

// The rider's city policy row (rider_policies). Any missing row or null column falls back to the number the server used
// before the table existed; each fallback is marked so the founder's decision can replace it.
export async function riderPolicy(riderId: string): Promise<RiderPolicy> {
  const who = await db().from('riders').select('city_id').eq('id', riderId).maybeSingle();
  if (who.error) fromDbError(who.error);
  let row: Row | null = null;
  if (who.data?.city_id) {
    const p = await db().from('rider_policies').select('*').eq('city_id', who.data.city_id).maybeSingle();
    if (p.error) fromDbError(p.error);
    row = p.data;
  }
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    // PROVISIONAL DEFAULT: founder decision pending (docs/DECISIONS.md Q-5/Q-11)
    withdrawMinMinor: num(row?.withdraw_min_minor) ?? 10_000,
    // PROVISIONAL DEFAULT: founder decision pending (docs/DECISIONS.md Q-5/Q-11)
    withdrawMaxMinor: num(row?.withdraw_max_minor) ?? 1_000_000,
    // PROVISIONAL DEFAULT: founder decision pending (docs/DECISIONS.md Q-5/Q-11)
    withdrawPerDay: num(row?.withdraw_per_day) ?? 3,
    // PROVISIONAL DEFAULT: founder decision pending (docs/DECISIONS.md Q-5/Q-11)
    defaultCashLimitMinor: num(row?.default_cash_limit_minor) ?? 500_000,
    // PROVISIONAL DEFAULT: founder decision pending (docs/DECISIONS.md Q-5/Q-11)
    unavailableWaitSeconds: num(row?.unavailable_wait_seconds) ?? Number(process.env.RIDER_UNAVAILABLE_WAIT_SECONDS ?? 300),
  };
}

const MASK = (phone: string) => `${'*'.repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
export const maskPhone = (phone: string | null | undefined) => (phone ? MASK(phone.replace(/\s+/g, '')) : undefined);

// ---------- uploads ----------

// What the apps call a file, and what the database calls it (delivery_assets.kind).
const KIND: Record<string, string> = {
  proof_photo: 'proof_photo', proof_signature: 'proof_signature', signature: 'proof_signature', exception_photo: 'exception_photo',
  kyc_document: 'kyc_document', aadhaar: 'kyc_document', pan: 'kyc_document', dl: 'kyc_document', driving_licence: 'kyc_document',
  permit: 'kyc_document', fitness: 'kyc_document', kyc_selfie: 'kyc_selfie', selfie: 'kyc_selfie', vehicle_rc: 'vehicle_rc', rc: 'vehicle_rc', profile_photo: 'profile_photo',
};
const CONTENT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
export const BUCKET = 'rider-uploads';

const uploadBody = z.object({ kind: z.string().min(1).max(40), content_type: z.string().min(1).max(60), job_id: z.string().optional() });

// POST /rider/uploads. A private file slot: the app PUTs the bytes to upload_url, then quotes asset_id.
export async function createUpload(rider: Who, raw: unknown) {
  const b = parse(uploadBody, raw);
  const kind = KIND[b.kind];
  if (!kind) throw new HttpError(400, 'kind: not a kind of file we accept', undefined, 'validation');
  const ext = CONTENT[b.content_type];
  if (!ext) throw new HttpError(400, 'content_type: use JPEG, PNG, WebP or PDF', undefined, 'validation');
  const job = b.job_id ? await ownJob(rider, b.job_id) : null; // evidence for a job must be for the rider's own job
  const id = crypto.randomUUID();
  // A file made for a job carries that job in its path (delivery_assets has no job column yet: db-requests-server.md), so a proof
  // can later be checked against the job it is quoted for. The Rider app that does not send job_id still works: see confirmJobAsset.
  const path = job ? `${rider.id}/jobs/${job.id}/${id}.${ext}` : `${rider.id}/${id}.${ext}`;
  const signed = await db().storage.from(BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data) { console.error('[uploads] signed url failed', signed.error?.message); throw new HttpError(502, 'Uploads are not available right now.', undefined, 'upload_unavailable'); }
  const { error } = await db().from('delivery_assets').insert({ id, rider_id: rider.id, kind, content_type: b.content_type, storage_path: path, status: 'pending' });
  if (error) fromDbError(error);
  return { asset_id: id, upload_url: signed.data.signedUrl };
}

// An asset a rider quotes (profile photo, KYC document, RC) must be theirs, of the right kind, and really uploaded.
export async function confirmAsset(rider: Who, assetId: string, kinds: string[]) {
  if (!UUID.test(assetId)) throw new HttpError(400, 'asset_id: not a valid file', undefined, 'validation');
  const { data: asset, error } = await db().from('delivery_assets').select('id, kind, status, storage_path').eq('id', assetId).eq('rider_id', rider.id).maybeSingle();
  if (error) fromDbError(error);
  if (!asset) throw notFound('File');
  if (!kinds.includes(asset.kind)) throw new HttpError(400, 'asset_id: this file is for something else', undefined, 'validation');
  if (asset.status === 'rejected') throw new HttpError(422, 'This file was rejected. Please upload it again.', undefined, 'validation');
  if (asset.status !== 'uploaded') {
    const there = await db().storage.from(BUCKET).exists(asset.storage_path);
    if (there.error || !there.data) throw new HttpError(422, 'The file has not finished uploading.', undefined, 'upload_missing');
    const info = await db().storage.from(BUCKET).info(asset.storage_path);
    await db().from('delivery_assets').update({ status: 'uploaded', uploaded_at: new Date().toISOString(), size_bytes: info.data?.size ?? null }).eq('id', assetId);
  }
  return asset.id as string;
}

// Evidence for a delivery (the proof photo or signature, a problem photo) is stricter than a profile photo (SRV-1). On top of
// confirmAsset (the rider's own file, of the right kind, really in storage), it must be an image with bytes in it, belong to THIS job,
// and not have been used before: a rider cannot quote a file that was never uploaded, someone else's, one made for another job,
// one from before this job was theirs, or the same photo again and again.
//   * job: a file made with job_id has the job in its path and must match; a file made without it (the Rider app today) must have been
//     made after the rider accepted this job, which also rules out a file kept from an earlier delivery.
//   * once: a file already attached to a proof or to a problem is refused.
export async function confirmJobAsset(rider: Who, job: Row, assetId: string, kinds: string[], use: 'proof' | 'problem') {
  await confirmAsset(rider, assetId, kinds);
  const { data: asset, error } = await db().from('delivery_assets').select('id, content_type, storage_path, size_bytes, created_at').eq('id', assetId).eq('rider_id', rider.id).single();
  if (error) fromDbError(error);
  const refuse = (detail: string) => new HttpError(422, detail, undefined, 'validation');
  if (!String(asset.content_type).startsWith('image/')) throw refuse('asset_id: a photo or a signature must be an image');
  if (asset.size_bytes != null && Number(asset.size_bytes) <= 0) throw refuse('asset_id: the file is empty');
  const bound = String(asset.storage_path).match(/^[^/]+\/jobs\/([0-9a-f-]{36})\//i);
  if (bound) {
    if (bound[1].toLowerCase() !== String(job.id).toLowerCase()) throw refuse('asset_id: this file was made for another delivery');
  } else {
    const { data: accepted, error: acceptedError } = await db().from('delivery_assignments').select('answered_at')
      .eq('job_id', job.id).eq('rider_id', rider.id).eq('outcome', 'accepted').order('answered_at', { ascending: false }).limit(1).maybeSingle();
    if (acceptedError) fromDbError(acceptedError);
    if (!accepted?.answered_at || Date.parse(asset.created_at) < Date.parse(accepted.answered_at) - 1000) throw refuse('asset_id: this file was made before you took this delivery');
  }
  const used = use === 'proof'
    ? await db().from('delivery_proofs').select('id').eq('asset_id', assetId).limit(1)
    : await db().from('delivery_exceptions').select('id').eq('asset_id', assetId).limit(1);
  if (used.error) fromDbError(used.error);
  if (used.data?.length) throw new HttpError(409, 'asset_id: this file was already used', undefined, 'validation');
  return asset.id as string;
}

// ---------- jobs the rider owns ----------

async function ownJob(rider: Who, jobId: string): Promise<Row> {
  uuidParam(jobId, 'Job');
  const { data, error } = await db().from('delivery_jobs').select('*').eq('id', jobId).eq('rider_id', rider.id).maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw notFound('Job');
  return data;
}
async function activeJob(rider: Who, jobId: string) {
  const job = await ownJob(rider, jobId);
  if (!ACTIVE.includes(job.status)) throw new HttpError(409, 'This delivery is no longer active.', undefined, 'wrong_state');
  return job;
}

// ---------- GPS track ----------

const point = z.object({
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0).max(100_000).nullish(), speed: z.number().min(-1).max(200).nullish(), heading: z.number().min(-1).max(360).nullish(),
  recorded_at: z.string().refine(s => Number.isFinite(Date.parse(s)), 'not a time'),
}).refine(p => !(p.lat === 0 && p.lng === 0), { message: 'not a real position' });
const trackBody = z.object({ points: z.array(point).min(1).max(60) });

const MAX_SPEED_MS = 70; // 250 km/h: faster than that between two fixes is a GPS jump, not a rider
const MAX_AGE_MS = 24 * 3600_000, MAX_AHEAD_MS = 5 * 60_000;

// POST /rider/jobs/:id/track. Only for the rider's own live job. Duplicates (same time) are ignored, so a retried
// batch is safe. A fix with a time in the far future or past, or that jumps impossibly far, is dropped, not stored.
export async function recordTrack(rider: Who, jobId: string, raw: unknown) {
  const { points } = parse(trackBody, raw);
  await activeJob(rider, jobId);
  const now = Date.now();
  const sorted = points.map(p => ({ ...p, at: Date.parse(p.recorded_at) })).sort((a, b) => a.at - b.at);
  const kept: typeof sorted = [];
  for (const p of sorted) {
    if (p.at > now + MAX_AHEAD_MS || p.at < now - MAX_AGE_MS) continue;
    const last = kept[kept.length - 1];
    if (last && p.at > last.at && distanceKm(last, p) * 1000 / ((p.at - last.at) / 1000) > MAX_SPEED_MS) continue;
    kept.push(p);
  }
  let stored = 0;
  if (kept.length) {
    const rows = kept.map(p => ({
      job_id: jobId, rider_id: rider.id, lat: p.lat, lng: p.lng, accuracy_m: p.accuracy_m ?? null,
      speed: p.speed != null && p.speed >= 0 ? p.speed : null, heading: p.heading != null && p.heading >= 0 ? p.heading : null,
      recorded_at: new Date(p.at).toISOString(),
    }));
    const { data, error } = await db().from('rider_tracks').upsert(rows, { onConflict: 'job_id,rider_id,recorded_at', ignoreDuplicates: true }).select('id');
    if (error) fromDbError(error);
    stored = data?.length ?? 0;
    // The heartbeat stops during a job (the rider app sends tracks instead), so without this the rider's position in
    // rider_availability, which dispatch and the customer's tracking read, would go stale mid-job. Only an online rider's row, only
    // forward in time, and best effort: the points are already safe, so a failure here must not fail (and so retry) the batch.
    const newest = kept[kept.length - 1];
    const seenAt = new Date(Math.min(newest.at, now)).toISOString();
    const { error: seenError } = await db().from('rider_availability')
      .update({ lat: newest.lat, lng: newest.lng, accuracy_m: newest.accuracy_m != null ? Math.round(newest.accuracy_m) : null, last_seen_at: seenAt })
      .eq('rider_id', rider.id).eq('online', true).or(`last_seen_at.is.null,last_seen_at.lt.${seenAt}`);
    if (seenError) console.warn('[track] could not refresh the rider position:', (seenError as { code?: string }).code ?? 'error');
  }
  return { ok: true, received: points.length, stored, dropped: points.length - kept.length };
}

// ---------- a waiting problem ends ----------

const resolveBody = z.object({ kind: z.enum(['not_ready', 'unavailable']), outcome: z.enum(['continue', 'escalate']) });

// POST /rider/jobs/:id/exception/resolve. Only the two waiting problems: the rider says the wait is over (continue,
// done by the same database function operations uses) or asks operations for help (escalate, the problem stays open).
export async function resolveWait(rider: Who, jobId: string, raw: unknown, key: string | null) {
  const b = parse(resolveBody, raw);
  const job = await ownJob(rider, jobId);
  const { data: ex, error } = await db().from('delivery_exceptions').select('*').eq('job_id', job.id).eq('kind', b.kind).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) fromDbError(error);
  const dto = (e: Row) => ({ id: e.id, jobId: e.job_id, kind: e.kind, note: e.note ?? undefined, status: e.status, resolution: e.outcome ?? undefined, createdAt: e.created_at, resolvedAt: e.resolved_at ?? undefined });
  // The same tap again after it worked: answer the same.
  if (ex?.status === 'resolved' && ex.outcome === 'resume' && b.outcome === 'continue') {
    return { exception: dto(ex), jobState: displayState(job), nextActions: ['continue'], message: 'The wait is over.' };
  }
  if (!ex || ex.status !== 'open' || job.status !== 'exception') throw new HttpError(409, 'There is no open problem of that kind on this delivery.', undefined, 'wrong_state');

  if (b.outcome === 'continue') {
    await rpc('dispatch_resolve_exception', { p_exception: ex.id, p_outcome: 'resume', p_note: 'rider: wait is over', p_actor: `rider:${rider.id}`, p_request_id: key ? `rider:${key}` : `rider-resolve:${ex.id}` });
    const now = await ownJob(rider, jobId);
    const { data: done } = await db().from('delivery_exceptions').select('*').eq('id', ex.id).single();
    return { exception: dto(done ?? ex), jobState: displayState(now), nextActions: ['continue'], message: 'Back on the delivery.' };
  }

  // escalate: operations is told through the event feed; the delivery stays on hold.
  // How long a rider must wait for an unavailable customer before asking operations to step in: the city's policy.
  const UNAVAILABLE_WAIT_S = (await riderPolicy(rider.id)).unavailableWaitSeconds;
  const waited = (Date.now() - Date.parse(ex.created_at)) / 1000;
  if (b.kind === 'unavailable' && waited < UNAVAILABLE_WAIT_S) {
    const left = Math.ceil(UNAVAILABLE_WAIT_S - waited);
    throw Object.assign(new HttpError(409, 'Please wait a little longer for the customer first.', undefined, 'wait_not_elapsed'), { extra: { wait_seconds: left } });
  }
  const { data: seen } = await db().from('delivery_events').select('id').eq('job_id', job.id).eq('kind', 'delivery.exception_escalated').contains('meta', { exception_id: ex.id }).limit(1);
  if (!seen?.length) {
    const ins = await db().from('delivery_events').insert({ job_id: job.id, v: job.version, kind: 'delivery.exception_escalated', meta: { exception_id: ex.id, exception_kind: b.kind, by: 'rider', rider_id: rider.id } });
    if (ins.error) fromDbError(ins.error);
  }
  return { exception: dto(ex), jobState: displayState(job), nextActions: ['await_operations'], message: 'Operations has been told.' };
}

// ---------- SOS ----------

const sosBody = z.object({ job_id: z.string().nullish(), lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish() });

// POST /rider/sos. Idempotent on the Idempotency-Key. The alert is a row operations reads and an event on the job;
// the push back to the rider is best effort and never fails the request. No emergency contact is messaged: that
// needs a messaging provider, so contact_alert is null.
export async function raiseSos(rider: Who, raw: unknown, key: string | null) {
  const b = parse(sosBody, raw);
  let job: Row | null = null;
  if (b.job_id) job = await ownJob(rider, b.job_id);
  const row = { rider_id: rider.id, job_id: job?.id ?? null, lat: b.lat ?? null, lng: b.lng ?? null, idempotency_key: key };
  const ins = await db().from('rider_sos').insert(row).select('id, created_at').single();
  let sos = ins.data as Row | null;
  let replayed = false;
  if (ins.error) {
    if ((ins.error as { code?: string }).code !== '23505' || !key) fromDbError(ins.error);
    const { data } = await db().from('rider_sos').select('id, created_at').eq('rider_id', rider.id).eq('idempotency_key', key).single();
    sos = data; replayed = true;
  }
  if (!sos) throw new HttpError(500, 'Something went wrong. Please try again.');
  if (!replayed) {
    try {
      if (job) await db().from('delivery_events').insert({ job_id: job.id, v: job.version, kind: 'delivery.sos', meta: { sos_id: sos.id, rider_id: rider.id } });
      await db().from('rider_notifications').insert({ rider_id: rider.id, kind: 'sos', title: 'SOS received', body: 'Operations has been alerted and can see your location.', data: { sos_id: sos.id } });
      await pushToRider(rider.id, { title: 'SOS received', body: 'Operations has been alerted.', data: { type: 'sos', sos_id: sos.id }, sound: false });
    } catch (error) { console.warn('[sos] notification failed', error instanceof Error ? error.message : error); }
  }
  return { ok: true, sos_id: sos.id, replayed, contact_alert: null };
}

// ---------- calling the customer ----------

// POST /rider/jobs/:id/call. V1 of the contract: the customer's number, only while the job is live and the rider's.
// There is no masked-call provider yet, so nothing is masked; every request is logged.
export async function callCustomer(rider: Who, jobId: string) {
  const job = await activeJob(rider, jobId);
  const number = typeof job.customer_phone === 'string' ? job.customer_phone.trim() : '';
  if (!number) throw new HttpError(404, 'There is no number to call for this delivery.', undefined, 'not_found');
  const { error } = await db().from('delivery_call_log').insert({ job_id: job.id, rider_id: rider.id });
  if (error) fromDbError(error);
  return { number };
}

// ---------- delivery code resend ----------

const RESEND_PER_HOUR = 3, RESEND_COOLDOWN_S = 30;

// POST /rider/jobs/:id/otp/resend. At most 3 an hour and one every 30 seconds per job. No messaging provider is
// wired into this server yet, so nothing is sent and the receipt says so honestly (skipped, channel null).
export async function resendDeliveryCode(rider: Who, jobId: string) {
  const job = await ownJob(rider, jobId);
  if (!['picked_up', 'at_drop'].includes(job.status)) throw new HttpError(409, 'The delivery code can be resent once the order is picked up.', undefined, 'wrong_state');
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { data, error } = await db().from('delivery_otp_resends').select('sent_at').eq('job_id', job.id).gte('sent_at', since).order('sent_at', { ascending: false });
  if (error) fromDbError(error);
  const recent = data ?? [];
  if (recent.length) {
    const wait = Math.ceil(RESEND_COOLDOWN_S - (Date.now() - Date.parse(recent[0].sent_at)) / 1000);
    if (wait > 0) throw new HttpError(429, `Please wait ${wait} seconds before resending.`, { 'Retry-After': String(wait) }, 'rate_limited');
  }
  if (recent.length >= RESEND_PER_HOUR) {
    const wait = Math.max(1, Math.ceil((Date.parse(recent[RESEND_PER_HOUR - 1].sent_at) + 3600_000 - Date.now()) / 1000));
    throw new HttpError(429, 'Too many resends for this delivery. Please try again later.', { 'Retry-After': String(wait) }, 'rate_limited');
  }
  const ins = await db().from('delivery_otp_resends').insert({ job_id: job.id });
  if (ins.error) fromDbError(ins.error);
  console.warn('[otp-resend] no messaging provider is configured: the delivery code was not sent for job', job.id);
  return { channel: null, status: 'skipped', fallback_used: false, fallback_reason: 'whatsapp_unavailable', sent_at: new Date().toISOString(), resend_after_seconds: RESEND_COOLDOWN_S };
}

// ---------- notifications ----------

// GET /rider/notifications?cursor=
export async function listNotifications(rider: Who, cursor: string | null) {
  const c = decodeCursor(cursor);
  let q = db().from('rider_notifications').select('id, kind, title, body, data, read_at, created_at').eq('rider_id', rider.id)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE + 1);
  if (c) q = q.or(afterCursor(c));
  const { data, error } = await q;
  if (error) fromDbError(error);
  const rows = data ?? [];
  const items = rows.slice(0, PAGE);
  return { items, next_cursor: rows.length > PAGE ? encodeCursor(items[items.length - 1] as any) : null };
}

const readBody = z.object({ ids: z.array(z.string().max(60)).max(100) });
// POST /rider/notifications/read {ids}. Ids that are not this rider's change nothing.
export async function markNotificationsRead(rider: Who, raw: unknown) {
  const { ids } = parse(readBody, raw);
  const valid = ids.filter(i => UUID.test(i));
  if (!valid.length) return { ok: true, updated: 0 };
  const { data, error } = await db().from('rider_notifications').update({ read_at: new Date().toISOString() }).eq('rider_id', rider.id).in('id', valid).is('read_at', null).select('id');
  if (error) fromDbError(error);
  return { ok: true, updated: data?.length ?? 0 };
}
