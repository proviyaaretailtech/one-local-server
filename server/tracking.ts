// Live navigation and tracking (specs/live-navigation-eta): the two reads that sit on top of routing.ts.
//   * POST /api/rider/route          the rider's road route to the pickup or the drop (riderRoute)
//   * GET  /api/orders/:id/tracking  what the customer's order screen draws: rider, route, ETA (orderTracking)
// Both read the delivery job as it is in the database. The destination is ALWAYS taken from the job, never from the caller, and the
// drop is only ever used for a rider once the order is picked up (the same moment the rider app is shown the drop pin: dispatch.ts riderJob).
import { db, fromDbError } from './db';
import { HttpError } from './http';
import { encodePolyline, haversineM, trimAhead, LatLng, projectOnPolyline } from './geometry';
import { routeFor, Route, RouteAnswer, LEG_TTL_MS } from './routing';
import { ownOrderForTracking } from './store';
import type { Rider } from './rider';

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (detail: string) => new HttpError(400, detail, undefined, 'validation');

// ---------- what state a job is really in ----------
// A job held for a problem is treated as the state it was in before the problem. A problem that closed the delivery (failed, returned)
// is over: nobody is driving anywhere.
function effective(job: Row): { status: string; closed: boolean } {
  if (job.status !== 'exception') return { status: job.status, closed: ['delivered', 'cancelled'].includes(job.status) };
  const closed = ['failed', 'returned'].includes(job.step);
  return { status: job.exception_from_status ?? 'assigned', closed };
}
const WITH_RIDER = ['assigned', 'at_pickup', 'picked_up', 'at_drop'];

// ---------- POST /api/rider/route ----------
export async function riderRoute(rider: Rider, b: Row) {
  if (typeof b.job_id !== 'string' || !UUID.test(b.job_id)) throw bad('job_id: send the id of your delivery.');
  const from = b.from as Row | undefined;
  if (!from || typeof from !== 'object' || typeof from.lat !== 'number' || typeof from.lng !== 'number'
      || !Number.isFinite(from.lat) || !Number.isFinite(from.lng) || Math.abs(from.lat) > 90 || Math.abs(from.lng) > 180 || (from.lat === 0 && from.lng === 0)) {
    throw bad('from: send your location (lat and lng).');
  }
  // A rider sees only their own jobs: the filter is the permission.
  const { data: job, error } = await db().from('delivery_jobs')
    .select('id, status, step, exception_from_status, pickup_name, pickup_lat, pickup_lng, drop_area, drop_address, drop_lat, drop_lng')
    .eq('id', b.job_id).eq('rider_id', rider.id).maybeSingle();
  if (error) fromDbError(error);
  if (!job) throw new HttpError(404, 'Job not found', undefined, 'not_found');
  const state = effective(job);
  if (state.closed || !WITH_RIDER.includes(state.status)) throw new HttpError(409, 'This delivery is no longer active.', undefined, 'wrong_state');

  // Before the order is picked up the only place to go is the pickup; the customer's pin is not used (the rider app is not shown it yet).
  const target: 'pickup' | 'drop' = ['picked_up', 'at_drop'].includes(state.status) ? 'drop' : 'pickup';
  const to: LatLng = target === 'pickup' ? { lat: job.pickup_lat, lng: job.pickup_lng } : { lat: job.drop_lat, lng: job.drop_lng };
  const label = target === 'pickup' ? String(job.pickup_name ?? 'Pickup') : String(job.drop_address ?? job.drop_area ?? 'Drop');
  const answer = await routeFor({ key: `${job.id}:${target}`, from: { lat: from.lat, lng: from.lng }, to });
  return { target, destination: { lat: to.lat, lng: to.lng, label }, route: answer.route };
}

// ---------- GET /api/orders/:id/tracking ----------
const STALE_AFTER_MS = 90_000;
const POLL_MOVING_S = 10, POLL_IDLE_S = 30;
const MIN_ETA_MS = 60_000;

type Phase = 'preparing' | 'finding_rider' | 'to_store' | 'at_store' | 'on_the_way' | 'at_door' | 'delivered' | 'cancelled';
type Eta = { minutes: number; arrives_at: string; source: 'road' | 'estimate' | 'promise'; updated_at: string };

const etaOf = (totalS: number, source: Eta['source'], now: number): Eta => {
  const ms = Math.max(MIN_ETA_MS, totalS * 1000);
  return { minutes: Math.ceil(ms / 60_000), arrives_at: new Date(now + ms).toISOString(), source, updated_at: new Date(now).toISOString() };
};

// Before a rider is on the way: what the customer was promised (promised_eta_at, else when the order was placed + its ETA minutes).
export function promiseEta(order: Row, now: number): Eta | null {
  const at = order.promised_eta_at ? Date.parse(order.promised_eta_at)
    : Number(order.eta_minutes) > 0 && order.created_at ? Date.parse(order.created_at) + Number(order.eta_minutes) * 60_000 : NaN;
  if (!Number.isFinite(at)) return null;
  const left = at - now;
  return left >= MIN_ETA_MS
    ? { minutes: Math.ceil(left / 60_000), arrives_at: new Date(at).toISOString(), source: 'promise', updated_at: new Date(now).toISOString() }
    : etaOf(0, 'promise', now); // the promise has passed: never show 0 or a time in the past
}

// The phase from the order and its job. `status` is the order's own status, used when there is no job to read.
export function phaseOf(orderStatus: string, job: Row | null): Phase {
  if (orderStatus === 'cancelled') return 'cancelled';
  if (!job) return orderStatus === 'delivered' ? 'delivered' : orderStatus === 'out' ? 'on_the_way' : 'preparing';
  if (orderStatus === 'delivered') return 'delivered';
  const s = effective(job);
  if (s.closed) return s.status === 'delivered' ? 'delivered' : 'cancelled';
  switch (s.status) {
    case 'assigned': return 'to_store';
    case 'at_pickup': return 'at_store';
    case 'picked_up': return 'on_the_way';
    case 'at_drop': return 'at_door';
    case 'delivered': return 'delivered';
    case 'cancelled': return 'cancelled';
    default: return job.released_at ? 'finding_rider' : 'preparing'; // created, offered: the restaurant has not released it, or no rider has taken it
  }
}

// Where the rider is, and how fresh that is: the newest of the rider's last GPS point on this job and their availability row (kept
// fresh by the heartbeat and by recordTrack). Heading and speed come only from the GPS points.
type Seen = { lat: number; lng: number; at: number; heading: number | null };
function whereIs(avail: Row | null, tracks: Row[]): { seen: Seen | null; stationary: boolean } {
  const newest = tracks[0] ?? null;
  const fromTrack: Seen | null = newest ? { lat: newest.lat, lng: newest.lng, at: Date.parse(newest.recorded_at), heading: typeof newest.heading === 'number' ? newest.heading : null } : null;
  const fromAvail: Seen | null = avail && avail.lat != null && avail.lng != null && avail.last_seen_at
    ? { lat: avail.lat, lng: avail.lng, at: Date.parse(avail.last_seen_at), heading: null } : null;
  const seen = fromTrack && (!fromAvail || fromTrack.at >= fromAvail.at) ? fromTrack : fromAvail;
  let stationary = false;
  if (newest) {
    if (typeof newest.speed === 'number') stationary = newest.speed < 0.5;
    else if (tracks[1]) stationary = haversineM(newest as LatLng, tracks[1] as LatLng) < 8;
  }
  return { seen: seen && Number.isFinite(seen.at) ? seen : null, stationary };
}

const trimmed = (answer: RouteAnswer, from: LatLng): string => {
  const projection = projectOnPolyline(answer.points, from);
  return encodePolyline(projection ? trimAhead(answer.points, projection) : answer.points);
};

// The order's stage from the restaurant's side (0580 ol_order_stage): waiting for the restaurant, kitchen ticket created, preparing, ready,
// or why it was cancelled and where the refund is. "Accepted" only ever shows once the kitchen ticket exists. The realtime topic
// ol-order:<id> pushes the same object; this read is what the app falls back to (and what a guest without realtime sees).
async function stageOf(orderId: string): Promise<Row | null> {
  try {
    const { data, error } = await db().rpc('ol_order_stage', { p_ol: orderId });
    if (error) return null;
    return (data as Row | null) ?? null;
  } catch { return null; } // tracking still works without it
}

export async function orderTracking(request: Request, id: string) {
  const { row: order, status: orderStatus } = await ownOrderForTracking(request, id);
  const [tracking, stage] = await Promise.all([trackOrder(order, orderStatus), order ? stageOf(String(order.id)) : Promise.resolve(null)]);
  return { ...tracking, stage };
}

async function trackOrder(order: Row | null, orderStatus: string) {
  const now = Date.now();
  const notLive = (phase: Phase) => ({ live: false, phase, rider: null, store: null, drop: null, eta: null, route: null, poll_after_s: POLL_IDLE_S });
  if (!order) return notLive(phaseOf(orderStatus, null)); // demo memory store: no dispatch data

  const { data: job, error } = await db().from('delivery_jobs')
    .select('id, status, step, rider_id, released_at, prep_minutes, pickup_name, pickup_lat, pickup_lng, drop_lat, drop_lng, exception_from_status')
    .eq('ol_order_id', order.id).maybeSingle();
  if (error) fromDbError(error);
  if (!job) return notLive(phaseOf(orderStatus, null));

  const phase = phaseOf(orderStatus, job);
  const store = { lat: job.pickup_lat as number, lng: job.pickup_lng as number, name: (job.pickup_name as string | null) ?? null };
  const drop = { lat: job.drop_lat as number, lng: job.drop_lng as number };
  const base = { live: true, phase, store, drop };

  const riderActive = !!job.rider_id && ['to_store', 'at_store', 'on_the_way', 'at_door'].includes(phase);
  if (!riderActive) {
    // No rider yet, or the delivery is over: nothing is drawn, and a finished order has no ETA.
    const over = phase === 'delivered' || phase === 'cancelled';
    return { ...base, rider: null, eta: over ? null : promiseEta(order, now), route: null, poll_after_s: POLL_IDLE_S };
  }

  const [{ data: person, error: personError }, { data: avail, error: availError }, { data: tracks, error: trackError }] = await Promise.all([
    db().from('riders').select('full_name, vehicle').eq('id', job.rider_id).maybeSingle(),
    db().from('rider_availability').select('lat, lng, last_seen_at').eq('rider_id', job.rider_id).maybeSingle(),
    db().from('rider_tracks').select('lat, lng, heading, speed, recorded_at').eq('job_id', job.id).order('recorded_at', { ascending: false }).limit(3),
  ]);
  for (const e of [personError, availError, trackError]) if (e) fromDbError(e);
  const { seen, stationary } = whereIs(avail, tracks ?? []);
  if (!seen) return { ...base, rider: null, eta: promiseEta(order, now), route: null, poll_after_s: POLL_IDLE_S }; // assigned, no position yet

  const here: LatLng = { lat: seen.lat, lng: seen.lng };
  const stale = now - seen.at > STALE_AFTER_MS;
  const rider = {
    first_name: String(person?.full_name ?? '').trim().split(/\s+/)[0] || 'Rider', vehicle: (person?.vehicle as string | null) ?? null,
    lat: seen.lat, lng: seen.lng, heading: seen.heading, seen_at: new Date(seen.at).toISOString(), stale,
  };
  const poll = stale || stationary ? POLL_IDLE_S : POLL_MOVING_S;

  // ETA by phase. Each road leg is a kept Google route (routing.ts), so this is local arithmetic on most polls.
  const roads: Route['source'][] = [];
  let totalS = 0, line: string | null = null;
  if (phase === 'at_door') {
    return { ...base, rider, eta: etaOf(0, 'estimate', now), route: null, poll_after_s: poll };
  }
  if (phase === 'on_the_way') {
    const leg = await routeFor({ key: `${job.id}:drop`, from: here, to: drop, fromAt: seen.at });
    roads.push(leg.route.source); totalS = leg.progress.remaining_s; line = trimmed(leg, here);
  } else {
    // to_store / at_store: the later of "rider reaches the store" and "food is ready", then the ride to the customer.
    let toStoreS = 0;
    if (phase === 'to_store') {
      const leg = await routeFor({ key: `${job.id}:pickup`, from: here, to: store, fromAt: seen.at });
      roads.push(leg.route.source); toStoreS = leg.progress.remaining_s; line = trimmed(leg, here);
    }
    const prepMin = job.prep_minutes ?? order.prep_minutes;
    const prepLeftS = job.released_at && prepMin != null ? Math.max(0, (Date.parse(job.released_at) + Number(prepMin) * 60_000 - now) / 1000) : 0;
    const ride = await routeFor({ key: `${job.id}:store_drop`, from: store, to: drop, ttlMs: LEG_TTL_MS });
    roads.push(ride.route.source);
    totalS = Math.max(toStoreS, prepLeftS) + ride.route.duration_s;
  }
  const source: Eta['source'] = roads.every(s => s === 'google') ? 'road' : 'estimate';
  return { ...base, rider, eta: etaOf(totalS, source, now), route: line ? { polyline: line } : null, poll_after_s: poll };
}
