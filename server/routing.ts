// Road routes and the time they take, for the rider's in-app directions and the customer's live ETA (specs/live-navigation-eta).
//
// Google is called ONLY from here, with the server's key (GOOGLE_MAPS_API_KEY, Routes API computeRoutes, two-wheeler, with traffic).
// A route is fetched once per (job, target) and kept; after that, every position update is turned into "how far is left" by
// projecting the position onto the kept polyline (geometry.ts), so a hundred polls cost one Google call. A new call is made only when:
//   * there is nothing kept for this (job, target), or
//   * what is kept is older than ROUTE_TTL_MS (120 s: traffic moves), or
//   * the rider is more than OFF_ROUTE_M (80 m) from the kept line (a wrong turn), or
//   * the destination moved (a corrected drop pin).
// The target changing (store, then customer) is a different (job, target) key, so it starts with nothing kept.
// Two guards keep the bill bounded: a re-fetch for "off route" waits MIN_REFETCH_MS after the last call for that key, and after a
// Google failure that key is not asked again for FAIL_BACKOFF_MS. Without a key, or when Google fails, the answer is an
// ESTIMATE (straight line x 1.35 at 20 km/h, source "estimate"): the apps keep working, just less exactly.
//
// The kept routes live in this process's memory. A host that runs several processes keeps one copy per process, so the call count
// is "once per process per window", never "once per poll".
import { cumulativeM, decodePolyline, encodePolyline, haversineM, isOffRoute, LatLng, projectOnPolyline } from './geometry';
import { redact } from './http';

export type { LatLng };
export type RouteStep = { instruction: string; maneuver: string | null; distance_m: number; duration_s: number; end: LatLng };
// The contract's Route object (specs/live-navigation-eta/spec.md): the route as fetched, so distance_m and duration_s are the totals
// for `polyline`. The apps work out what is left by projecting a position onto the polyline.
export type Route = { source: 'google' | 'estimate'; distance_m: number; duration_s: number; polyline: string; steps: RouteStep[]; fetched_at: string };

export const OFF_ROUTE_M = 80;
export const ROUTE_TTL_MS = 120_000;
export const LEG_TTL_MS = 600_000;       // the store-to-customer leg does not depend on the rider's position: a slower refresh is enough
export const MIN_REFETCH_MS = 10_000;
export const FAIL_BACKOFF_MS = 30_000;
const STALE_GRACE_MS = 600_000;          // a kept route is still better than a guess for ten minutes past its time after Google stops answering
const NEAR_DESTINATION_M = 30;           // closer than this there is nothing to route
const DESTINATION_MOVED_M = 25;
export const ROAD_FACTOR = 1.35;
export const ESTIMATE_KMH = 20;

// ---------- Google Routes API ----------
const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = [
  'routes.duration', 'routes.distanceMeters', 'routes.polyline.encodedPolyline', 'routes.legs.steps.navigationInstruction',
  'routes.legs.steps.distanceMeters', 'routes.legs.steps.staticDuration', 'routes.legs.steps.endLocation',
].join(',');
// 6 s by default; GOOGLE_ROUTES_TIMEOUT_MS (1 to 30 s) widens it for a slow network. A route that is late is an estimate, not a wait.
const timeoutMs = () => Math.min(30_000, Math.max(1000, Number(process.env.GOOGLE_ROUTES_TIMEOUT_MS) || 6000));

// Why a Google route could not be had. `detail` has been through redact(); `status` is Google's HTTP status when there was one.
export class RoutingError extends Error {
  constructor(public reason: 'no_key' | 'http' | 'network' | 'no_route' | 'bad_response', public detail: string, public status?: number) { super(`${reason}: ${detail}`); }
}

const seconds = (v: unknown) => { const n = parseFloat(String(v ?? '0')); return Number.isFinite(n) ? n : 0; }; // Google sends durations as "123s"
const latLng = (v: any): LatLng | null => (v && typeof v.latitude === 'number' && typeof v.longitude === 'number' ? { lat: v.latitude, lng: v.longitude } : null);

export function parseGoogleRoute(body: any, now = new Date()): Route {
  const r = body?.routes?.[0];
  const polyline = r?.polyline?.encodedPolyline;
  if (!r) throw new RoutingError('no_route', 'Google found no route between these points');
  if (typeof polyline !== 'string' || !polyline) throw new RoutingError('bad_response', 'Google sent a route without a line');
  const steps: RouteStep[] = [];
  for (const leg of Array.isArray(r.legs) ? r.legs : []) {
    for (const s of Array.isArray(leg?.steps) ? leg.steps : []) {
      const end = latLng(s?.endLocation?.latLng);
      if (!end) continue;
      steps.push({
        instruction: String(s?.navigationInstruction?.instructions ?? 'Continue').slice(0, 300),
        maneuver: typeof s?.navigationInstruction?.maneuver === 'string' ? s.navigationInstruction.maneuver : null,
        distance_m: Math.round(Number(s?.distanceMeters) || 0), duration_s: Math.round(seconds(s?.staticDuration)), end,
      });
    }
  }
  return { source: 'google', distance_m: Math.round(Number(r.distanceMeters) || 0), duration_s: Math.round(seconds(r.duration)), polyline, steps, fetched_at: now.toISOString() };
}

// One computeRoutes call. Never logs or returns the key: anything that leaves here has been through redact().
export async function fetchGoogleRoute(from: LatLng, to: LatLng): Promise<Route> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) throw new RoutingError('no_key', 'GOOGLE_MAPS_API_KEY is not set');
  const waypoint = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify({ origin: waypoint(from), destination: waypoint(to), travelMode: 'TWO_WHEELER', routingPreference: 'TRAFFIC_AWARE', languageCode: 'en-IN', units: 'METRIC' }),
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (error) {
    throw new RoutingError('network', redact((error as Error)?.name === 'TimeoutError' ? 'timed out' : (error as Error)?.message ?? 'request failed').slice(0, 200));
  }
  const text = await response.text().catch(() => '');
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* not JSON: reported below */ }
  if (!response.ok) {
    const e = body?.error;
    throw new RoutingError('http', redact(`${e?.status ?? ''} ${e?.message ?? text}`.trim()).slice(0, 400), response.status);
  }
  return parseGoogleRoute(body);
}

// ---------- The estimate (no key, or Google failed) ----------
export function estimateRoute(from: LatLng, to: LatLng, now = new Date()): Route {
  const distance = Math.round(haversineM(from, to) * ROAD_FACTOR);
  const duration = Math.round(distance / ((ESTIMATE_KMH * 1000) / 3600));
  return {
    source: 'estimate', distance_m: distance, duration_s: duration, polyline: encodePolyline([from, to]),
    steps: [{ instruction: 'Head towards the destination', maneuver: null, distance_m: distance, duration_s: duration, end: to }],
    fetched_at: now.toISOString(),
  };
}

// ---------- Progress along a kept route ----------
export type Progress = { alongM: number; offsetM: number; remaining_m: number; remaining_s: number; fractionLeft: number };

// How much of the route is left for a rider at `position`: the share of the polyline still ahead of their projection, applied to the
// route's total distance and duration (remaining / total x duration).
export function progressOn(route: Route, points: LatLng[], position: LatLng, cumulative = cumulativeM(points)): Progress {
  const total = cumulative[cumulative.length - 1] ?? 0;
  const projection = projectOnPolyline(points, position, cumulative);
  const left = projection && total > 0 ? Math.min(1, Math.max(0, (total - projection.alongM) / total)) : projection ? 0 : 1;
  return {
    alongM: projection?.alongM ?? 0, offsetM: projection?.offsetM ?? Infinity, fractionLeft: left,
    remaining_m: Math.round(route.distance_m * left), remaining_s: Math.round(route.duration_s * left),
  };
}

// ---------- The kept routes ----------
type Entry = { route: Route; points: LatLng[]; cumulative: number[]; to: LatLng; fetchedAt: number };
type Store = { routes: Map<string, Entry>; inflight: Map<string, Promise<Entry>>; failedUntil: Map<string, number>; told: Map<string, number>; calls: number };
const g = globalThis as unknown as { __onelocalRoutes?: Store };
const store: Store = (g.__onelocalRoutes ??= { routes: new Map(), inflight: new Map(), failedUntil: new Map(), told: new Map(), calls: 0 });
const MAX_KEPT = 5000, KEEP_MS = 3_600_000;

// For checks and operations: how many times Google was really asked since this process started, and a way to start clean.
export const googleCallCount = () => store.calls;
export function resetRouteCache() { store.routes.clear(); store.inflight.clear(); store.failedUntil.clear(); store.told.clear(); store.calls = 0; }

function tell(key: string, error: unknown) {
  // One line per minute per key: a broken key must not turn every poll into a log line.
  const now = Date.now();
  if ((store.told.get(key) ?? 0) > now - 60_000) return;
  store.told.set(key, now);
  const e = error as RoutingError;
  console.warn('[routing] Google route unavailable, using an estimate:', e?.reason ?? 'error', e?.status ?? '', redact(e?.detail ?? e?.message ?? error).slice(0, 300));
}

function keep(key: string, entry: Entry) {
  if (store.routes.size >= MAX_KEPT) {
    for (const [k, v] of store.routes) if (Date.now() - v.fetchedAt > KEEP_MS) store.routes.delete(k);
    for (const k of store.routes.keys()) { if (store.routes.size < MAX_KEPT * 0.8) break; store.routes.delete(k); } // oldest first
  }
  store.routes.set(key, entry);
}

async function fetchAndKeep(key: string, from: LatLng, to: LatLng): Promise<Entry> {
  const running = store.inflight.get(key);
  if (running) return running; // many polls arriving together share one call
  const run = (async () => {
    store.calls++;
    const route = await fetchGoogleRoute(from, to);
    const points = decodePolyline(route.polyline);
    if (points.length < 2) throw new RoutingError('bad_response', 'Google sent a route with fewer than two points');
    const entry: Entry = { route, points, cumulative: cumulativeM(points), to, fetchedAt: Date.now() };
    keep(key, entry);
    store.failedUntil.delete(key);
    return entry;
  })().finally(() => store.inflight.delete(key));
  store.inflight.set(key, run);
  return run;
}

export type RouteAnswer = {
  route: Route;            // as fetched (or the estimate): totals for `points`
  points: LatLng[];        // the decoded line
  progress: Progress;      // what is left for the position asked about
  fresh: boolean;          // true when this call asked Google
};

export type RouteRequest = {
  key: string;             // one per (job, target), e.g. "<job id>:pickup"
  from: LatLng;            // where the rider is
  to: LatLng;              // where they are going: always worked out by the server, never taken from a client
  fromAt?: number;         // when `from` was true (ms). A position older than the kept route says nothing about being off it.
  ttlMs?: number;
};

// The route for this (job, target) and what is left of it. Asks Google only under the rules in the header; otherwise answers from
// what is kept. Never throws for a Google problem: the answer is then the kept route (if it is recent enough) or an estimate.
export async function routeFor(req: RouteRequest): Promise<RouteAnswer> {
  const now = Date.now(), ttl = req.ttlMs ?? ROUTE_TTL_MS;
  let entry = store.routes.get(req.key);
  let reason: 'none' | 'moved' | 'expired' | 'off_route' | null = null;
  if (!entry) reason = 'none';
  else if (haversineM(entry.to, req.to) > DESTINATION_MOVED_M) reason = 'moved';
  else if (now - entry.fetchedAt >= ttl) reason = 'expired';
  else if ((req.fromAt === undefined || req.fromAt > entry.fetchedAt) && isOffRoute(projectOnPolyline(entry.points, req.from, entry.cumulative), OFF_ROUTE_M)) reason = 'off_route';

  let fresh = false;
  if (reason) {
    const tooSoon = reason === 'off_route' && !!entry && now - entry.fetchedAt < MIN_REFETCH_MS;
    const backingOff = (store.failedUntil.get(req.key) ?? 0) > now;
    const close = haversineM(req.from, req.to) < NEAR_DESTINATION_M;
    if (!tooSoon && !backingOff && !close && process.env.GOOGLE_MAPS_API_KEY?.trim()) {
      try { entry = await fetchAndKeep(req.key, req.from, req.to); fresh = true; }
      catch (error) {
        store.failedUntil.set(req.key, Date.now() + FAIL_BACKOFF_MS);
        tell(req.key, error);
      }
    }
    // Google was not asked (or failed). What is kept is still good when it is merely old and the rider is on it, or when a wrong
    // turn is too recent to ask again. A kept line that leads somewhere else, or that the rider has left for good, is not.
    if (!fresh && entry) {
      const keepOld = tooSoon || (reason === 'expired' && now - entry.fetchedAt < ttl + STALE_GRACE_MS);
      if (!keepOld) entry = undefined;
    }
  }
  if (!entry) {
    const route = estimateRoute(req.from, req.to);
    const points = [req.from, req.to];
    return { route, points, progress: progressOn(route, points, req.from), fresh: false };
  }
  return { route: entry.route, points: entry.points, progress: progressOn(entry.route, entry.points, req.from, entry.cumulative), fresh };
}
