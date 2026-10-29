// Live order tracking: the response shape, and the small pure rules behind the order screen and its map.
// No React, no React Native, no i18n: everything here is checked by scripts/tracking-ui-checks.ts and shared by
// the polling hook (src/use-live-tracking.ts), the map components and app/order/[id].tsx.
// Contract: specs/live-navigation-eta/spec.md, `GET /api/orders/:id/tracking`.
import type { LatLng } from './polyline';
export type { LatLng } from './polyline';

// ---------- shape ----------
export type TrackingPhase = 'preparing' | 'finding_rider' | 'to_store' | 'at_store' | 'on_the_way' | 'at_door' | 'delivered' | 'cancelled';
export const TRACKING_PHASES: readonly TrackingPhase[] = ['preparing', 'finding_rider', 'to_store', 'at_store', 'on_the_way', 'at_door', 'delivered', 'cancelled'];
export type EtaSource = 'road' | 'estimate' | 'promise';
export type TrackingRider = { first_name: string; vehicle: string | null; lat: number; lng: number; heading: number | null; seen_at: string; stale: boolean };
export type TrackingEta = { minutes: number; arrives_at: string; source: EtaSource; updated_at: string };
export type TrackingLive = {
  live: true; phase: TrackingPhase; rider: TrackingRider | null;
  store: LatLng & { name: string | null }; drop: LatLng;
  eta: TrackingEta | null; route: { polyline: string } | null; poll_after_s: number; stage: OrderStage | null;
};
// `live: false` = no dispatch data (demo mode, no job yet): the screen keeps its illustrative simulation.
export type TrackingNotLive = { live: false; poll_after_s: number; stage: OrderStage | null };

// ---------- the restaurant's side of the order (database 0580, specs/order-accept-kot) ----------
// `stage` comes with every tracking answer and on the realtime topic ol-order:<id>. "Accepted" is only ever shown once the
// restaurant's kitchen ticket exists (kitchen_ticket_created): the database creates the ticket in the same step as the accept.
export type OrderStageCode =
  | 'created' | 'waiting_partner' | 'kitchen_ticket_created' | 'preparing' | 'ready' | 'out' | 'delivered'
  | 'rejected_by_partner' | 'auto_cancelled' | 'auto_cancelled_ghost' | 'customer_cancelled' | 'ops_cancelled' | 'cancelled';
export const ORDER_STAGES: readonly OrderStageCode[] = ['created', 'waiting_partner', 'kitchen_ticket_created', 'preparing', 'ready', 'out', 'delivered',
  'rejected_by_partner', 'auto_cancelled', 'auto_cancelled_ghost', 'customer_cancelled', 'ops_cancelled', 'cancelled'];
export type RefundState = 'none' | 'initiated' | 'processed' | 'delayed';
const REFUND_STATES: readonly string[] = ['none', 'initiated', 'processed', 'delayed'];
export type OrderStage = {
  stage: OrderStageCode; kot_no: number | null; deadline: string | null; prep_minutes: number | null; eta_minutes: number | null;
  cancel_reason: string | null; refund: RefundState; refund_amount: number | null;
};
export type TrackingData = TrackingLive | TrackingNotLive;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isLat = (v: unknown): v is number => isNum(v) && v >= -90 && v <= 90;
const isLng = (v: unknown): v is number => isNum(v) && v >= -180 && v <= 180;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** The order's stage, or null when the answer has none (an older server, or no database). An unknown stage code is null too. */
export function parseStage(raw: unknown): OrderStage | null {
  if (!isObj(raw) || typeof raw.stage !== 'string' || !ORDER_STAGES.includes(raw.stage as OrderStageCode)) return null;
  return {
    stage: raw.stage as OrderStageCode,
    kot_no: numOrNull(raw.kot_no), deadline: isTime(raw.deadline) ? raw.deadline : null,
    prep_minutes: numOrNull(raw.prep_minutes), eta_minutes: numOrNull(raw.eta_minutes),
    cancel_reason: typeof raw.cancel_reason === 'string' && raw.cancel_reason.trim() ? raw.cancel_reason.trim() : null,
    refund: typeof raw.refund === 'string' && REFUND_STATES.includes(raw.refund) ? raw.refund as RefundState : 'none',
    refund_amount: numOrNull(raw.refund_amount),
  };
}
export const isCancelledStage = (s: OrderStage | null): boolean => !!s && (s.stage === 'rejected_by_partner' || s.stage.endsWith('cancelled'));
/** Nothing more will happen to the order (polling can stop). */
export const isFinalStage = (s: OrderStage | null): boolean => !!s && (s.stage === 'delivered' || isCancelledStage(s));
/** The restaurant's own words of a rejection ("Restaurant: Out of milk" -> "Out of milk"), or null. */
export const partnerReason = (reason: string | null): string | null => (reason ? reason.replace(/^Restaurant:\s*/i, '').trim() || null : null);
const ETA_SOURCES: readonly string[] = ['road', 'estimate', 'promise'];

/** A heading in degrees, folded into [0, 360). Not a number -> null. */
export const normalizeHeading = (h: unknown): number | null => (isNum(h) ? ((h % 360) + 360) % 360 : null);

/**
 * Checks a response body before the screen trusts it. A body that is not a tracking response gives null (the
 * screen then behaves as if there were no live data); a live response with a damaged OPTIONAL part (rider, eta,
 * route) keeps the rest and drops only that part, so one bad field never blanks the map.
 */
export function parseTracking(raw: unknown): TrackingData | null {
  if (!isObj(raw)) return null;
  const poll_after_s = clampPollS(raw.poll_after_s);
  const stage = parseStage(raw.stage);
  if (raw.live !== true) return { live: false, poll_after_s, stage };
  if (typeof raw.phase !== 'string' || !TRACKING_PHASES.includes(raw.phase as TrackingPhase)) return null;
  const s = raw.store, d = raw.drop;
  if (!isObj(s) || !isLat(s.lat) || !isLng(s.lng) || !isObj(d) || !isLat(d.lat) || !isLng(d.lng)) return null;
  let rider: TrackingRider | null = null;
  const r = raw.rider;
  if (isObj(r) && isLat(r.lat) && isLng(r.lng) && typeof r.first_name === 'string' && r.first_name.trim()) {
    rider = {
      first_name: r.first_name.trim(), vehicle: typeof r.vehicle === 'string' && r.vehicle.trim() ? r.vehicle.trim() : null,
      lat: r.lat, lng: r.lng, heading: normalizeHeading(r.heading), seen_at: typeof r.seen_at === 'string' ? r.seen_at : '', stale: r.stale === true,
    };
  }
  let eta: TrackingEta | null = null;
  const e = raw.eta;
  if (isObj(e) && isNum(e.minutes) && e.minutes >= 0 && isTime(e.arrives_at) && typeof e.source === 'string' && ETA_SOURCES.includes(e.source)) {
    eta = { minutes: e.minutes, arrives_at: e.arrives_at, source: e.source as EtaSource, updated_at: typeof e.updated_at === 'string' ? e.updated_at : '' };
  }
  const rt = raw.route;
  const route = isObj(rt) && typeof rt.polyline === 'string' && rt.polyline.length > 0 ? { polyline: rt.polyline } : null;
  return {
    live: true, phase: raw.phase as TrackingPhase, rider,
    store: { lat: s.lat, lng: s.lng, name: typeof s.name === 'string' && s.name ? s.name : null },
    drop: { lat: d.lat, lng: d.lng }, eta, route, poll_after_s, stage,
  };
}

// ---------- phases ----------
export const isTerminalPhase = (phase: TrackingPhase) => phase === 'delivered' || phase === 'cancelled';

/** The rows of the live timeline, in order. `cancelled` is not a row: it replaces the whole timeline. */
export const LIVE_TIMELINE: readonly TrackingPhase[] = ['preparing', 'finding_rider', 'to_store', 'at_store', 'on_the_way', 'at_door', 'delivered'];
/** Which timeline row the order is on (0-6); -1 for cancelled. */
export const timelineIndex = (phase: TrackingPhase): number => LIVE_TIMELINE.indexOf(phase);

/**
 * The 4 steps the iOS Live Activity and widget know (placed, packed, out, delivered; ORDER_STAGES in
 * src/native/ios-extras.ts) from the real phase. `orderStatus` is the order's own status: until the store accepts it
 * (status 'placed') the order is still "placed", not "being packed". Cancelled has no step (null): the screen leaves
 * the Live Activity alone and clears the widget.
 */
export function activityStepFor(phase: TrackingPhase, orderStatus?: string | null): 0 | 1 | 2 | 3 | null {
  switch (phase) {
    case 'preparing': case 'finding_rider': return orderStatus === 'placed' ? 0 : 1;
    case 'to_store': case 'at_store': return 1;
    case 'on_the_way': case 'at_door': return 2;
    case 'delivered': return 3;
    default: return null;
  }
}

// ---------- ETA ----------
export type EtaView =
  | { kind: 'eta'; minutes: number; approx: boolean; source: EtaSource; arrivesAt: string }
  | { kind: 'unknown' } | { kind: 'at_door' } | { kind: 'delivered' } | { kind: 'cancelled' };

/**
 * What the ETA card should say, before any words are chosen. A road ETA (live GPS + traffic) is shown as it is;
 * an estimate (straight-line guess) and the promise (the time given at checkout) are shown with "about".
 */
export function describeEta(eta: TrackingEta | null, phase: TrackingPhase): EtaView {
  if (phase === 'delivered') return { kind: 'delivered' };
  if (phase === 'cancelled') return { kind: 'cancelled' };
  if (phase === 'at_door') return { kind: 'at_door' };
  if (!eta) return { kind: 'unknown' };
  return { kind: 'eta', minutes: eta.minutes, approx: eta.source !== 'road', source: eta.source, arrivesAt: eta.arrives_at };
}

// ---------- polling ----------
export const DEFAULT_POLL_S = 10;
export const MIN_POLL_S = 3;
export const MAX_POLL_S = 120;
export const MAX_BACKOFF_MS = 60_000;
export const clampPollS = (v: unknown): number => (isNum(v) ? Math.min(MAX_POLL_S, Math.max(MIN_POLL_S, v)) : DEFAULT_POLL_S);

/**
 * Wait before the next request. After a good answer: what the server asked for (`poll_after_s`, kept between 3 and
 * 120 s). After `failures` bad answers in a row: 5 s, 10 s, 20 s, 40 s, then 60 s, with +-10 % jitter so many
 * phones do not retry in step. `rand` (0..1) is injectable so the rule can be checked exactly.
 */
export function nextPollDelayMs(pollAfterS: number | undefined, failures: number, rand = 0.5): number {
  if (failures <= 0) return Math.round(clampPollS(pollAfterS) * 1000);
  const base = Math.min(MAX_BACKOFF_MS, 5000 * 2 ** (failures - 1));
  return Math.round(base * (0.9 + 0.2 * Math.min(1, Math.max(0, rand))));
}

// ---------- gliding the rider between fixes ----------
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpLatLng = (a: LatLng, b: LatLng, t: number): LatLng => ({ lat: lerp(a.lat, b.lat, t), lng: lerp(a.lng, b.lng, t) });
/** Turn from `a` to `b` by the SHORT way round (350 -> 10 passes 0, not 180). Result in [0, 360). */
export function lerpAngle(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180;
  return (((a + diff * t) % 360) + 360) % 360;
}
/** 0..1 progress of a glide; a zero or negative duration is "already there". */
export const glideT = (elapsedMs: number, durationMs: number) => (durationMs > 0 ? Math.min(1, Math.max(0, elapsedMs / durationMs)) : 1);
/** The marker takes about one poll interval to reach the newest fix, so it is still moving when the next one lands. */
export const glideDurationMs = (pollAfterS: number) => Math.round(Math.min(20_000, Math.max(1_000, pollAfterS * 1000)));
/** A jump bigger than this is a re-sync (phone was asleep, GPS jump), not riding: the marker snaps instead of gliding. */
export const SNAP_DISTANCE_M = 2000;

const R_EARTH_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Compass bearing from `a` to `b`, 0 = north, clockwise. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

export type RiderFix = { lat: number; lng: number; heading: number | null };
/**
 * Where the marker is `t` of the way from `from` to `to`. A fix with no heading takes the direction it moved in
 * (once it has moved more than 5 m); with no movement either it keeps the old heading. Null stays null until a
 * direction is known, so the marker can show a neutral icon instead of an arrow pointing nowhere.
 */
export function glideFix(from: RiderFix, to: RiderFix, t: number): RiderFix {
  const p = lerpLatLng(from, to, t);
  const moved = haversineM(from, to);
  const target = to.heading ?? (moved > 5 ? bearingDeg(from, to) : from.heading);
  const heading = target === null ? null : from.heading === null ? target : lerpAngle(from.heading, target, t);
  return { lat: p.lat, lng: p.lng, heading };
}

// ---------- map framing ----------
export type Bounds = { south: number; west: number; north: number; east: number };
export const MIN_SPAN_DEG = 0.004; // about 440 m: never zoom in closer than this, even when every point is the same

export function boundsOf(points: LatLng[], minSpanDeg = MIN_SPAN_DEG): Bounds | null {
  if (points.length === 0) return null;
  let south = 90, north = -90, west = 180, east = -180;
  for (const p of points) { south = Math.min(south, p.lat); north = Math.max(north, p.lat); west = Math.min(west, p.lng); east = Math.max(east, p.lng); }
  if (north - south < minSpanDeg) { const mid = (north + south) / 2; south = mid - minSpanDeg / 2; north = mid + minSpanDeg / 2; }
  if (east - west < minSpanDeg) { const mid = (east + west) / 2; west = mid - minSpanDeg / 2; east = mid + minSpanDeg / 2; }
  return { south, west, north, east };
}
export const boundsContain = (outer: Bounds, inner: Bounds | LatLng): boolean => {
  const b: Bounds = 'south' in inner ? inner : { south: inner.lat, north: inner.lat, west: inner.lng, east: inner.lng };
  return b.south >= outer.south && b.north <= outer.north && b.west >= outer.west && b.east <= outer.east;
};
/**
 * The map is a fixed-size card (no pinch or pan), so it re-frames itself, but only when that helps: the first time,
 * when something now falls outside the frame, or when everything has come at least twice as close (the rider is
 * near, zoom in). Re-framing on every poll would make the map jitter.
 */
export function shouldRefit(prev: Bounds | null, next: Bounds): boolean {
  if (!prev) return true;
  if (!boundsContain(prev, next)) return true;
  return (next.north - next.south) < (prev.north - prev.south) * 0.5 && (next.east - next.west) < (prev.east - prev.west) * 0.5;
}

/** The points the map should keep in view for this phase: both ends before pickup, the rider and the door after. */
export function framePoints(t: { phase: TrackingPhase; rider: LatLng | null; store: LatLng; drop: LatLng }, route: LatLng[]): LatLng[] {
  const pts: LatLng[] = [];
  const afterPickup = t.phase === 'on_the_way' || t.phase === 'at_door';
  pts.push({ lat: t.drop.lat, lng: t.drop.lng });
  if (!afterPickup) pts.push({ lat: t.store.lat, lng: t.store.lng });
  for (const p of route) pts.push(p);
  if (t.rider && !isTerminalPhase(t.phase)) pts.push({ lat: t.rider.lat, lng: t.rider.lng });
  return pts;
}

/**
 * Plain (no-map) rendering: lat/lng to x/y inside a w x h box with `pad` margin. North is up, and a degree of
 * longitude is shortened by cos(latitude) so the picture is not stretched. The whole bounds fit, centred.
 */
export function makeProjector(b: Bounds, w: number, h: number, pad = 24): (p: LatLng) => { x: number; y: number } {
  const kx = Math.cos(rad((b.north + b.south) / 2));
  const spanX = Math.max((b.east - b.west) * kx, 1e-9), spanY = Math.max(b.north - b.south, 1e-9);
  const scale = Math.max(1e-9, Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY));
  const offX = (w - spanX * scale) / 2, offY = (h - spanY * scale) / 2;
  return p => ({ x: offX + (p.lng - b.west) * kx * scale, y: offY + (b.north - p.lat) * scale });
}

// ---------- small display helpers ----------
/** First letter of the rider's first name for the avatar (a whole character, so Devanagari is not cut in half). */
export const riderInitial = (name: string): string => (Array.from(name.trim())[0] ?? '').toUpperCase();
const VEHICLE_CODES = ['bike', 'scooter', 'cycle', 'car'] as const;
/** The server stores bike / scooter / cycle / car. Anything else is shown as the server wrote it. */
export const vehicleCode = (vehicle: string | null | undefined): (typeof VEHICLE_CODES)[number] | null => {
  const v = (vehicle ?? '').trim().toLowerCase();
  return (VEHICLE_CODES as readonly string[]).includes(v) ? (v as (typeof VEHICLE_CODES)[number]) : null;
};
