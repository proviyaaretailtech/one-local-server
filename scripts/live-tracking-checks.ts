// Checks "Live navigation, live tracking and ETA" (specs/live-navigation-eta/spec.md) end to end through the real server code:
//   A. geometry (polyline decode/encode, projection, off-route, remaining distance)         no network, no database
//   B. routing (request shape, estimate fallback, ONE Google call across many polls, re-fetch rules)   Google is a fake
//   C. POST /api/rider/route and GET /api/orders/:id/tracking against the LOCAL Supabase     Google is a fake
//   D. recordTrack keeps rider_availability fresh
//   E. ONE real call to the Google Routes API (informational: it reports whether the key is switched on for Routes)
// Sign-in is simulated (fetch is stubbed for Supabase Auth and for Google); the database is real and local. It refuses to run against
// anything but localhost, tags what it creates 'ZZ-TEST' (riders are named ZZ ..., logins are zz-live-*@example.test) and removes it.
// The real Google key is read from .env, held in memory, sent only to routes.googleapis.com in section E and NEVER printed or logged.
// Run from frontend/:  npx tsx scripts/live-tracking-checks.ts   (needs frontend/.env.localdb.off and, for E, GOOGLE_MAPS_API_KEY in .env)
import { readFileSync } from 'node:fs';
const ROOT = process.cwd();
for (const line of readFileSync(`${ROOT}/.env.localdb.off`, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !m[1].startsWith('GOOGLE_')) process.env[m[1]] = m[2]; // the Google keys are handled below, on purpose
}
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');
const REAL_KEY = (() => {
  try { const m = readFileSync(`${ROOT}/.env`, 'utf8').match(/^GOOGLE_MAPS_API_KEY=(.*)$/m); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; } catch { return ''; }
})();
const FAKE_KEY = ['AI', 'za', 'FakeKeyForChecks'.padEnd(35, 'x')].join(''); // shaped like a Google key so redact() has something to catch
process.env.GOOGLE_MAPS_API_KEY = FAKE_KEY;

let passed = 0, failed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => {
  if (!ok) { failed++; console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); }
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// Everything the server logs is kept, so the end of the run can prove neither key was ever written out.
const logged: string[] = [];
for (const level of ['warn', 'error', 'log'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => { logged.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); original(...args); };
}

// ---------- fake Google, fake Supabase Auth ----------
type GoogleCall = { url: string; headers: Record<string, string>; body: any };
const googleCalls: GoogleCall[] = [];
let googleMode: 'ok' | 'forbidden' | 'real' = 'ok';
const tokenToUser = new Map<string, string>();
const realFetch = globalThis.fetch;

// A route that is the straight line from origin to destination in 10 pieces, 1.2 x as long on the road, at 6 m/s.
const fakeRoute = (body: any, encode: (p: { lat: number; lng: number }[]) => string, metres: (a: any, b: any) => number) => {
  const a = { lat: body.origin.location.latLng.latitude, lng: body.origin.location.latLng.longitude };
  const b = { lat: body.destination.location.latLng.latitude, lng: body.destination.location.latLng.longitude };
  const pts = Array.from({ length: 11 }, (_, i) => ({ lat: a.lat + ((b.lat - a.lat) * i) / 10, lng: a.lng + ((b.lng - a.lng) * i) / 10 }));
  const dist = Math.round(metres(a, b) * 1.2);
  const step = (i: number, maneuver: string | null, text: string) => ({
    navigationInstruction: { ...(maneuver ? { maneuver } : {}), instructions: text }, distanceMeters: Math.round(dist / 2), staticDuration: `${Math.round(dist / 12)}s`,
    endLocation: { latLng: { latitude: pts[i].lat, longitude: pts[i].lng } },
  });
  return { routes: [{ duration: `${Math.round(dist / 6)}s`, distanceMeters: dist, polyline: { encodedPolyline: encode(pts) },
    legs: [{ steps: [step(5, 'TURN_LEFT', 'Turn left onto Main Road'), step(10, null, 'Arrive at the destination')] }] }] };
};
let fakeEncode: (p: { lat: number; lng: number }[]) => string, fakeMetres: (a: any, b: any) => number;

globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://routes.googleapis.com/')) {
    if (googleMode === 'real') return realFetch(input, init);
    const body = JSON.parse(init.body);
    googleCalls.push({ url, headers: init.headers, body });
    if (googleMode === 'forbidden') {
      return Response.json({ error: { code: 403, status: 'PERMISSION_DENIED', message: `Requests from this key (${FAKE_KEY}) to Routes API are blocked. https://routes.googleapis.com/directions/v2:computeRoutes?key=${FAKE_KEY}` } }, { status: 403 });
    }
    return Response.json(fakeRoute(body, fakeEncode, fakeMetres));
  }
  if (url.endsWith('/auth/v1/user')) { const t = String(init?.headers?.Authorization ?? '').slice(7); return tokenToUser.has(t) ? Response.json({ id: tokenToUser.get(t) }) : new Response('{}', { status: 401 }); }
  return realFetch(input, init);
}) as typeof fetch;

const EMAIL = (n: string) => `zz-live-${n}@example.test`;
// places in Latur: the store, the customer, and a rider 1.1 km north of the store
const S = { lat: 18.4088, lng: 76.5604 }, D = { lat: 18.4001, lng: 76.5702 }, R0 = { lat: 18.4188, lng: 76.5604 };

async function main() {
  const geo = await import('../server/geometry');
  const routing = await import('../server/routing');
  const tracking = await import('../server/tracking');
  const { db } = await import('../server/db');
  const { sha256 } = await import('../server/http');
  fakeEncode = geo.encodePolyline; fakeMetres = geo.haversineM;
  const d = db();
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
  const R = async (p: string) => import(`../app/api/${p}+api`);
  const routeRider = await R('rider/route'), routeTracking = await R('orders/[id]/tracking'), routeTrack = await R('rider/jobs/[id]/track');

  // time: the routes' rate windows and the 120 s route cache are driven by Date.now, so the checks move that clock instead of waiting
  const realNow = Date.now.bind(Date); let skew = 0;
  Date.now = () => realNow() + skew;
  const advance = (ms: number) => { skew += ms; };
  const iso = (ms = Date.now()) => new Date(ms).toISOString();

  const jwt = (id: string) => { const t = `token-${id}-`.padEnd(60, 'x'); tokenToUser.set(t, id); return t; };
  const req = (uid: string | null, url: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    new Request(`http://localhost/api/${url}`, { method, headers: { ...(uid ? { authorization: `Bearer ${jwt(uid)}` } : {}), 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const go = async (handler: any, r: Request, params: Record<string, string> = {}) => {
    const res: Response = await handler(r, params); const text = await res.text(); let body: any; try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body, text, headers: res.headers };
  };
  const fresh = () => { routing.resetRouteCache(); googleCalls.length = 0; googleMode = 'ok'; process.env.GOOGLE_MAPS_API_KEY = FAKE_KEY; };
  const roadSeconds = (a: any, b: any) => Math.round(Math.round(geo.haversineM(a, b) * 1.2) / 6);

  // =============== A. geometry ===============
  const sample = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'; // Google's own documentation example
  const decoded = geo.decodePolyline(sample);
  check('polyline: Google\'s documented example decodes to its three points', decoded.length === 3 && decoded[0].lat === 38.5 && decoded[0].lng === -120.2 && decoded[1].lat === 40.7 && decoded[1].lng === -120.95 && decoded[2].lat === 43.252 && decoded[2].lng === -126.453, decoded);
  check('polyline: encode(decode(x)) gives x back', geo.encodePolyline(decoded) === sample);
  const latur = Array.from({ length: 40 }, (_, i) => ({ lat: Math.round((18.4 + i * 0.00037 + Math.sin(i) * 0.0001) * 1e5) / 1e5, lng: Math.round((76.56 - i * 0.00021 + Math.cos(i) * 0.0001) * 1e5) / 1e5 }));
  const back = geo.decodePolyline(geo.encodePolyline(latur));
  check('polyline: 40 Latur points survive encode then decode exactly (precision 5)', back.length === 40 && back.every((p, i) => p.lat === latur[i].lat && p.lng === latur[i].lng));
  check('polyline: points either side of the equator and the meridian round-trip', JSON.stringify(geo.decodePolyline(geo.encodePolyline([{ lat: -0.00001, lng: 0.00001 }, { lat: 0.00002, lng: -0.00003 }, { lat: -33.86785, lng: 151.20732 }]))) === JSON.stringify([{ lat: -0.00001, lng: 0.00001 }, { lat: 0.00002, lng: -0.00003 }, { lat: -33.86785, lng: 151.20732 }]));
  check('polyline: empty string gives no points; a cut-off string does not throw', geo.decodePolyline('').length === 0 && geo.decodePolyline(sample.slice(0, 9)).length <= 3);
  check('haversine: one degree of latitude is about 111.2 km', near(geo.haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }), 111_195, 150));

  // a line 1 km east, then 1.1 km north
  const A = { lat: 18.4, lng: 76.56 }, B = { lat: 18.4, lng: 76.57 }, C = { lat: 18.41, lng: 76.57 };
  const line = [A, B, C], cum = geo.cumulativeM(line), AB = cum[1], BC = cum[2] - cum[1];
  const north = (m: number) => m / 111_195; // degrees of latitude for m metres
  const mid = { lat: A.lat, lng: (A.lng + B.lng) / 2 };
  let p = geo.projectOnPolyline(line, mid, cum)!;
  check('projection: a point on the line projects onto itself, halfway along the first leg', p.index === 0 && near(p.alongM, AB / 2, 0.5) && p.offsetM < 0.5, p);
  p = geo.projectOnPolyline(line, { lat: mid.lat + north(100), lng: mid.lng }, cum)!;
  check('projection: 100 m beside the line is 100 m off it, at the same distance along', near(p.offsetM, 100, 1) && near(p.alongM, AB / 2, 1), p);
  p = geo.projectOnPolyline(line, { lat: C.lat - north(BC / 2), lng: B.lng + 0.0004 }, cum)!;
  check('projection: a point beside the second leg projects onto that leg', p.index === 1 && near(p.alongM, AB + BC / 2, 1) && near(p.offsetM, 0.0004 * 111_195 * Math.cos(18.4 * Math.PI / 180), 1), p);
  check('off-route: 100 m away is off a route with an 80 m limit; 50 m is not; the line itself is not',
    geo.isOffRoute(geo.projectOnPolyline(line, { lat: mid.lat + north(100), lng: mid.lng }, cum), 80) && !geo.isOffRoute(geo.projectOnPolyline(line, { lat: mid.lat + north(50), lng: mid.lng }, cum), 80) && !geo.isOffRoute(geo.projectOnPolyline(line, mid, cum), 80));
  check('off-route: an empty line counts as off route', geo.isOffRoute(geo.projectOnPolyline([], mid), 80));
  const total = cum[2];
  check('remaining: at the start the whole line is left; at the corner only the second leg; at the end nothing',
    near(geo.remainingAlongM(total, geo.projectOnPolyline(line, A, cum)!), total, 0.5) && near(geo.remainingAlongM(total, geo.projectOnPolyline(line, B, cum)!), BC, 0.5) && geo.remainingAlongM(total, geo.projectOnPolyline(line, C, cum)!) < 0.5);
  p = geo.projectOnPolyline(line, { lat: C.lat + north(500), lng: C.lng }, cum)!;
  check('remaining: a point past the end is 0 left; a point before the start is all left', geo.remainingAlongM(total, p) < 0.5 && near(geo.remainingAlongM(total, geo.projectOnPolyline(line, { lat: A.lat, lng: A.lng - 0.01 }, cum)!), total, 0.5));
  p = geo.projectOnPolyline(line, mid, cum)!;
  const ahead = geo.trimAhead(line, p);
  check('trimAhead: starts at the rider, ends at the destination, and is as long as what is left', near(ahead[0].lat, mid.lat, 1e-6) && ahead[ahead.length - 1].lat === C.lat && near(geo.polylineLengthM(ahead), total - AB / 2, 1), ahead);

  const demoRoute: any = { source: 'google', distance_m: 2000, duration_s: 400, polyline: '', steps: [], fetched_at: iso() };
  const straight = [A, { lat: A.lat + north(2000), lng: A.lng }];
  let pr = routing.progressOn(demoRoute, straight, { lat: A.lat + north(500), lng: A.lng });
  check('progress: 25 % along a 2000 m / 400 s route leaves 1500 m and 300 s', near(pr.remaining_m, 1500, 6) && near(pr.remaining_s, 300, 2), pr);
  pr = routing.progressOn(demoRoute, straight, { lat: A.lat + north(2500), lng: A.lng });
  check('progress: past the end leaves 0', pr.remaining_m === 0 && pr.remaining_s === 0, pr);

  // =============== B. routing ===============
  fresh();
  const est = routing.estimateRoute(S, D);
  const estM = Math.round(geo.haversineM(S, D) * 1.35);
  check('estimate: straight line x 1.35 at 20 km/h, source "estimate", a two-point polyline and one step',
    est.source === 'estimate' && est.distance_m === estM && est.duration_s === Math.round(estM / (20_000 / 3600)) && geo.decodePolyline(est.polyline).length === 2 && est.steps.length === 1, est);

  delete process.env.GOOGLE_MAPS_API_KEY;
  let ans = await routing.routeFor({ key: 'k:nokey', from: S, to: D });
  check('no key: the answer is an estimate and Google is not called', ans.route.source === 'estimate' && googleCalls.length === 0 && routing.googleCallCount() === 0, ans.route);
  process.env.GOOGLE_MAPS_API_KEY = FAKE_KEY;

  const google = await routing.fetchGoogleRoute(S, D);
  const call = googleCalls[0];
  check('Google request: POST to the Routes API computeRoutes with the key and the field mask in headers, never in the address',
    call.url === 'https://routes.googleapis.com/directions/v2:computeRoutes' && call.headers['X-Goog-Api-Key'] === FAKE_KEY && !call.url.includes('key=')
    && call.headers['X-Goog-FieldMask'] === 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.endLocation', call.headers['X-Goog-FieldMask']);
  check('Google request: two-wheeler, traffic aware, en-IN, metric, origin and destination as given',
    call.body.travelMode === 'TWO_WHEELER' && call.body.routingPreference === 'TRAFFIC_AWARE' && call.body.languageCode === 'en-IN' && call.body.units === 'METRIC'
    && call.body.origin.location.latLng.latitude === S.lat && call.body.destination.location.latLng.longitude === D.lng, call.body);
  check('Google reply: parsed into the contract Route (totals, polyline, steps with instruction, maneuver, distance, duration, end)',
    google.source === 'google' && google.distance_m === Math.round(geo.haversineM(S, D) * 1.2) && google.duration_s === roadSeconds(S, D) && geo.decodePolyline(google.polyline).length === 11
    && google.steps.length === 2 && google.steps[0].instruction === 'Turn left onto Main Road' && google.steps[0].maneuver === 'TURN_LEFT' && google.steps[1].maneuver === null
    && typeof google.steps[0].end.lat === 'number' && google.steps[0].duration_s > 0 && !Number.isNaN(Date.parse(google.fetched_at)), google);

  // one Google call across many polls
  fresh();
  let last = Infinity, decreasing = true, calls = 0;
  for (let i = 0; i <= 24; i++) {
    const at = { lat: R0.lat + ((S.lat - R0.lat) * i) / 24, lng: R0.lng };
    ans = await routing.routeFor({ key: 'k:poll', from: at, to: S });
    if (ans.progress.remaining_s > last) decreasing = false;
    last = ans.progress.remaining_s; calls = googleCalls.length;
  }
  check('ONE Google call across 25 polls of a moving rider', calls === 1 && routing.googleCallCount() === 1, { calls });
  check('those polls show the time left falling from the whole trip to about nothing', decreasing && last <= 2 && ans.route.source === 'google', { last });

  // several polls at once share one call
  fresh();
  await Promise.all(Array.from({ length: 6 }, () => routing.routeFor({ key: 'k:flight', from: R0, to: S })));
  check('six polls arriving together share one Google call', googleCalls.length === 1, googleCalls.length);

  // off route
  fresh();
  await routing.routeFor({ key: 'k:off', from: R0, to: S });
  const wrong = { lat: (R0.lat + S.lat) / 2, lng: R0.lng + 0.004 }; // about 420 m east of the road
  ans = await routing.routeFor({ key: 'k:off', from: wrong, to: S });
  check('off route inside 10 s of the last call: no new call, the kept route still answers (guard against a flood)', googleCalls.length === 1 && ans.route.source === 'google', googleCalls.length);
  advance(11_000);
  ans = await routing.routeFor({ key: 'k:off', from: wrong, to: S, fromAt: Date.now() });
  check('off route (more than 80 m) later: ONE new call, routed from where the rider is now', googleCalls.length === 2 && googleCalls[1].body.origin.location.latLng.longitude === wrong.lng, googleCalls.length);
  await routing.routeFor({ key: 'k:off', from: wrong, to: S, fromAt: Date.now() });
  check('and the next poll from there is on the new route: no further call', googleCalls.length === 2);
  // a position older than the kept route says nothing about being off it
  advance(11_000);
  await routing.routeFor({ key: 'k:off', from: R0, to: S, fromAt: Date.now() - 60_000 });
  check('a position that is older than the kept route does not count as off route', googleCalls.length === 2, googleCalls.length);
  const onRoute = { lat: (wrong.lat + S.lat) / 2, lng: wrong.lng + (S.lng - wrong.lng) / 2 };
  await routing.routeFor({ key: 'k:off', from: onRoute, to: S, fromAt: Date.now() });
  check('a rider 60 m beside the line is still on route (GPS noise)', googleCalls.length === 2);

  // 120 s
  fresh();
  await routing.routeFor({ key: 'k:ttl', from: R0, to: S });
  advance(119_000); await routing.routeFor({ key: 'k:ttl', from: R0, to: S });
  check('119 s later: still the kept route', googleCalls.length === 1);
  advance(2_000); await routing.routeFor({ key: 'k:ttl', from: R0, to: S });
  check('after 120 s: one new call', googleCalls.length === 2);
  await routing.routeFor({ key: 'k:ttl', from: R0, to: S });
  check('and polls after that use it again', googleCalls.length === 2);

  // the target changes / the destination moves
  fresh();
  await routing.routeFor({ key: 'job1:pickup', from: R0, to: S });
  await routing.routeFor({ key: 'job1:drop', from: S, to: D });
  check('a new target (store, then customer) is a new route: one call each', googleCalls.length === 2);
  await routing.routeFor({ key: 'job1:drop', from: S, to: { lat: D.lat + 0.001, lng: D.lng } });
  check('a drop pin that moved by more than 25 m is routed again', googleCalls.length === 3);

  // nothing to route when the rider is already there
  fresh();
  ans = await routing.routeFor({ key: 'k:there', from: { lat: S.lat + 0.0001, lng: S.lng }, to: S });
  check('already within 30 m of the destination and nothing kept: no call, a tiny estimate', googleCalls.length === 0 && ans.route.source === 'estimate' && ans.route.distance_m < 30);

  // Google says no
  fresh(); googleMode = 'forbidden'; logged.length = 0;
  ans = await routing.routeFor({ key: 'k:403', from: R0, to: S });
  check('Google refuses (403): the answer is an estimate, not an error', ans.route.source === 'estimate' && ans.progress.remaining_s > 0, ans.route);
  await routing.routeFor({ key: 'k:403', from: R0, to: S }); await routing.routeFor({ key: 'k:403', from: R0, to: S });
  check('and the key is not asked again for 30 s (one call, not three)', googleCalls.length === 1, googleCalls.length);
  let refusal: any = null;
  try { await routing.fetchGoogleRoute(S, D); } catch (e) { refusal = e; }
  check('the refusal carries Google\'s status and message with the key removed', refusal instanceof routing.RoutingError && refusal.status === 403 && /PERMISSION_DENIED/.test(refusal.detail) && !refusal.detail.includes(FAKE_KEY) && !refusal.message.includes(FAKE_KEY), refusal?.detail);
  check('nothing the server logged for that failure contains the key', logged.some(l => l.includes('[routing]')) && logged.every(l => !l.includes(FAKE_KEY) && !l.includes('AIza')), logged);
  advance(31_000); googleMode = 'ok';
  ans = await routing.routeFor({ key: 'k:403', from: R0, to: S });
  check('30 s later, with Google working again: back to a real route', ans.route.source === 'google', googleCalls.length);

  // a kept route survives a Google outage
  fresh();
  await routing.routeFor({ key: 'k:out', from: R0, to: S });
  googleMode = 'forbidden'; advance(125_000);
  ans = await routing.routeFor({ key: 'k:out', from: R0, to: S });
  check('Google fails after a route was kept: the kept route keeps answering (not a guess)', ans.route.source === 'google' && ans.progress.remaining_s > 0);

  // =============== C. the two endpoints, against the local database ===============
  fresh();
  const users = new Map<string, string>();
  const list = (await d.auth.admin.listUsers({ perPage: 1000 })).data.users;
  const user = async (n: string, phone: string) => {
    const found = list.find(u => u.email === EMAIL(n));
    if (found) { users.set(n, found.id); return found.id; }
    const c = await d.auth.admin.createUser({ email: EMAIL(n), phone, email_confirm: true, phone_confirm: true });
    if (c.error) throw new Error(c.error.message);
    users.set(n, c.data.user!.id); return c.data.user!.id;
  };
  const uA = await user('a', '919900001001'), uB = await user('b', '919900001002');
  const riderIds = async () => (must(await d.from('riders').select('id').in('user_id', [uA, uB])) as any[]).map(r => r.id as string);
  const orderIds: string[] = [];
  async function cleanup(final: boolean) {
    const rids = await riderIds();
    const jobs = rids.length ? (must(await d.from('delivery_jobs').select('id, ol_order_id').in('rider_id', rids)) as any[]) : [];
    const mine = (must(await d.from('ol_orders').select('id').like('idempotency_key', 'zz-test-live-%')) as any[]).map(o => o.id);
    const jobsOfOrders = mine.length ? (must(await d.from('delivery_jobs').select('id').in('ol_order_id', mine)) as any[]).map(j => j.id) : [];
    const jobIds = [...new Set([...jobs.map(j => j.id), ...jobsOfOrders])];
    if (jobIds.length) { await d.from('delivery_exceptions').delete().in('job_id', jobIds); await d.from('delivery_jobs').delete().in('id', jobIds); }
    const orders = [...new Set([...jobs.map(j => j.ol_order_id), ...mine, ...orderIds])];
    if (orders.length) await d.rpc('ol_dev_purge_orders', { p_ids: orders, p_reason: 'live-tracking-checks cleanup' });
    if (rids.length) { await d.from('rider_availability').delete().in('rider_id', rids); await d.from('riders').delete().in('id', rids); }
    if (final) for (const id of [uA, uB]) await d.auth.admin.deleteUser(id);
  }
  await cleanup(false);

  const mkRider = async (uid: string, name: string, extra: any = {}) =>
    must(await d.from('riders').insert({ user_id: uid, full_name: name, type: 'solo', status: 'approved', vehicle: 'bike', city_id: 'latur', ...extra }).select('id'))[0].id as string;
  const rA = await mkRider(uA, 'ZZ-TEST Asha Rider'), rB = await mkRider(uB, 'ZZ-TEST Bhim Rider');
  const setPosition = async (rider: string, at: { lat: number; lng: number }, over: any = {}) =>
    must(await d.from('rider_availability').upsert({ rider_id: rider, online: true, lat: at.lat, lng: at.lng, accuracy_m: 9, last_seen_at: iso(), ...over }, { onConflict: 'rider_id' }).select('rider_id'));
  await setPosition(rA, R0);

  let seq = 0;
  // one scenario = one customer (a made-up login, so each has its own rate window), one order, one job
  async function scenario(o: { status: string; step?: string | null; rider?: string | null; job?: any; order?: any }) {
    const customer = crypto.randomUUID(); const n = ++seq;
    const order = must(await d.from('ol_orders').insert({
      customer_hash: await sha256(`user:${customer}`), idempotency_key: `zz-test-live-order-${n}-${crypto.randomUUID().slice(0, 8)}`, items: [{ id: 'x', name: 'ZZ-TEST item', qty: 1, price: 100 }],
      subtotal: 100, total: 100, status: 'accepted', payment_method: 'cod', eta_minutes: 40, delivery_address: { label: 'ZZ-TEST', text: 'ZZ-TEST Flat 4, Gandhi Chowk, Latur', lat: D.lat, lng: D.lng, notes: '' },
      promised_eta_at: iso(Date.now() + 40 * 60_000), ...(o.order ?? {}),
    }).select('*'))[0];
    orderIds.push(order.id);
    const job = must(await d.from('delivery_jobs').insert({
      ol_order_id: order.id, city_id: 'latur', status: o.status, step: o.step ?? null, idempotency_key: `zz-test-live-job-${n}-${crypto.randomUUID().slice(0, 8)}`, rider_id: o.rider === undefined ? rA : o.rider,
      payment_mode: 'cod', cash_to_collect: 100, items_count: 1, pickup_name: 'ZZ-TEST Kitchen', pickup_address: 'ZZ-TEST Shop 1, Station Road', pickup_lat: S.lat, pickup_lng: S.lng,
      drop_area: 'Gandhi Chowk', drop_address: 'ZZ-TEST Flat 4, Gandhi Chowk, Latur', drop_lat: D.lat, drop_lng: D.lng, customer_first_name: 'Asha', customer_phone: '+919888800001', otp_hash: 'zz',
      released_at: iso(Date.now() - 10 * 60_000), prep_minutes: 0, ...(o.job ?? {}),
    }).select('*'))[0];
    return { customer, order, job };
  }
  const trackOf = (s: { customer: string; order: any }, uid = s.customer) => go(routeTracking.GET, req(uid, `orders/${s.order.id}/tracking`), { id: s.order.id });
  const addTrack = async (job: any, rider: string, at: { lat: number; lng: number }, over: any = {}) =>
    must(await d.from('rider_tracks').insert({ job_id: job.id, rider_id: rider, lat: at.lat, lng: at.lng, speed: 5, heading: 180, accuracy_m: 8, recorded_at: iso(Date.now() - 2000), ...over }).select('id'));
  const minutesFor = (s: number) => Math.ceil(Math.max(60, s) / 60);

  // ---- rider route ----
  let s = await scenario({ status: 'assigned', step: 'to_pickup' });
  let r = await go(routeRider.POST, req(null, 'rider/route', 'POST', { job_id: s.job.id, from: R0 }));
  check('rider route: no sign-in: 401', r.status === 401, r);
  r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: 'nope', from: R0 }));
  check('rider route: job_id that is not an id: 400 validation', r.status === 400 && r.body.code === 'validation', r);
  r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: s.job.id }));
  check('rider route: no position: 400 validation', r.status === 400 && r.body.code === 'validation', r);
  r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: s.job.id, from: { lat: 0, lng: 0 } }));
  check('rider route: 0,0 is not a position: 400', r.status === 400, r);
  r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: s.job.id, from: { lat: 'a', lng: 1 } }));
  check('rider route: a position that is not numbers: 400', r.status === 400, r);
  r = await go(routeRider.POST, req(uB, 'rider/route', 'POST', { job_id: s.job.id, from: R0 }));
  check("rider route: another rider's job: 404", r.status === 404 && r.body.code === 'not_found', r);
  r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: crypto.randomUUID(), from: R0 }));
  check('rider route: a job that does not exist: 404', r.status === 404, r);

  fresh();
  const dropBlurred = (await (await import('../server/rider')).jobForRider({ id: rA } as any, s.job.id)).drop;
  r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: s.job.id, from: R0, destination: D, to: D, target: 'drop' }));
  check('rider route (before pickup): target is the pickup and the destination is the store', r.status === 200 && r.body.target === 'pickup' && r.body.destination.lat === S.lat && r.body.destination.lng === S.lng && r.body.destination.label === 'ZZ-TEST Kitchen', r);
  check('rider route (before pickup): Google was asked for a route to the STORE although the client sent the drop as a destination', googleCalls.length === 1 && googleCalls[0].body.destination.location.latLng.latitude === S.lat && googleCalls[0].body.destination.location.latLng.longitude === S.lng && googleCalls[0].body.origin.location.latLng.latitude === R0.lat, googleCalls[0]?.body);
  check('rider route (before pickup): the drop is nowhere in the answer, and the job already shows the rider only a blurred drop', !/18\.4001|76\.5702|Gandhi|Flat 4/.test(r.text) && dropBlurred.lat === 18.4 && dropBlurred.lng === 76.57 && dropBlurred.address === null, { text: r.text.slice(0, 200), dropBlurred });
  check('rider route: the route is the contract Route (google, totals, polyline ending at the store, steps)', r.body.route.source === 'google' && r.body.route.distance_m > 0 && r.body.route.duration_s > 0 && r.body.route.steps.length === 2 && near(geo.decodePolyline(r.body.route.polyline).slice(-1)[0].lat, S.lat, 1e-5), r.body.route);
  r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: s.job.id, from: { lat: R0.lat - 0.002, lng: R0.lng } }));
  check('rider route: asking again from further along the road costs no second Google call', r.status === 200 && googleCalls.length === 1, googleCalls.length);

  fresh();
  s = await scenario({ status: 'at_pickup', step: 'verified' });
  r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: s.job.id, from: S }));
  check('rider route: pickup verified but not yet picked up: still the pickup, the drop is still not given', r.status === 200 && r.body.target === 'pickup' && !/18\.4001|76\.5702/.test(r.text), r);

  fresh();
  s = await scenario({ status: 'picked_up', step: 'to_drop' });
  r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: s.job.id, from: S, destination: { lat: 1, lng: 1 } }));
  check('rider route (after pickup): target is the drop, with the precise drop pin and its address as the label', r.status === 200 && r.body.target === 'drop' && r.body.destination.lat === D.lat && r.body.destination.lng === D.lng && r.body.destination.label === 'ZZ-TEST Flat 4, Gandhi Chowk, Latur', r);
  check('rider route (after pickup): Google was asked for the job\'s drop, not the destination the client sent', googleCalls.length === 1 && googleCalls[0].body.destination.location.latLng.latitude === D.lat && googleCalls[0].body.destination.location.latLng.longitude === D.lng, googleCalls[0]?.body);

  s = await scenario({ status: 'at_drop', step: 'arrived' });
  r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: s.job.id, from: D }));
  check('rider route: at the drop: still the drop', r.status === 200 && r.body.target === 'drop', r);
  for (const [status, step] of [['delivered', null], ['cancelled', null]] as const) {
    s = await scenario({ status, step, job: status === 'delivered' ? { delivered_at: iso() } : {} });
    r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: s.job.id, from: R0 }));
    check(`rider route: a ${status} job: 409 wrong_state`, r.status === 409 && r.body.code === 'wrong_state', r);
  }
  s = await scenario({ status: 'exception', step: 'proof', job: { exception_kind: 'unavailable', exception_from_status: 'picked_up', exception_from_step: 'to_drop' } });
  r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: s.job.id, from: R0 }));
  check('rider route: a job held for a problem keeps the target it had (picked up: the drop)', r.status === 200 && r.body.target === 'drop', r);
  s = await scenario({ status: 'exception', step: 'returned', job: { exception_kind: 'refused', exception_from_status: 'at_drop', exception_from_step: 'handover' } });
  r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: s.job.id, from: R0 }));
  check('rider route: a delivery closed by a problem (returned): 409 wrong_state', r.status === 409 && r.body.code === 'wrong_state', r);

  // the key is only ever the server's: with no key, or a refusing Google, the rider still gets a route
  fresh(); delete process.env.GOOGLE_MAPS_API_KEY;
  s = await scenario({ status: 'assigned', step: 'to_pickup' });
  r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: s.job.id, from: R0 }));
  check('rider route: no key configured: 200 with an estimate route (straight line, one step)', r.status === 200 && r.body.route.source === 'estimate' && geo.decodePolyline(r.body.route.polyline).length === 2 && r.body.route.steps.length === 1 && googleCalls.length === 0, r);
  fresh(); googleMode = 'forbidden';
  r = await go(routeRider.POST, req(uA, 'rider/route', 'POST', { job_id: s.job.id, from: R0 }));
  check('rider route: Google refuses: 200 with an estimate, and the answer carries no key', r.status === 200 && r.body.route.source === 'estimate' && !r.text.includes('AIza'), r);
  fresh();

  // the rider route is limited to 20 a minute
  s = await scenario({ status: 'assigned', step: 'to_pickup', rider: rB });
  advance(61_000); // rider B has already used one call above
  let blocked = 0, okCount = 0;
  for (let i = 0; i < 22; i++) {
    r = await go(routeRider.POST, req(uB, 'rider/route', 'POST', { job_id: s.job.id, from: R0 }));
    if (r.status === 200) okCount++; else if (r.status === 429) blocked++;
  }
  check('rider route: 20 a minute, then 429 with Retry-After', okCount === 20 && blocked === 2 && !!r.headers.get('retry-after'), { okCount, blocked });
  advance(61_000);

  // ---- customer tracking ----
  fresh();
  s = await scenario({ status: 'assigned', step: 'to_pickup' });
  const other = crypto.randomUUID();
  let t = await trackOf(s, other);
  check("tracking: someone else's order: 404, and nothing of the order in the answer", t.status === 404 && JSON.stringify(t.body) === '{"detail":"Order not found"}', t);
  t = await go(routeTracking.GET, req(null, `orders/${s.order.id}/tracking`), { id: s.order.id });
  check('tracking: not signed in and no device: 404', t.status === 404, t);
  t = await go(routeTracking.GET, req(s.customer, 'orders/not-an-id/tracking'), { id: 'not-an-id' });
  check('tracking: an id that is not an id: 404', t.status === 404, t);
  t = await go(routeTracking.GET, req(s.customer, `orders/${crypto.randomUUID()}/tracking`), { id: crypto.randomUUID() });
  check('tracking: an order that does not exist: 404', t.status === 404, t);
  const device = `zz-test-device-${crypto.randomUUID()}`.slice(0, 40);
  t = await go(routeTracking.GET, req(null, `orders/${s.order.id}/tracking`, 'GET', undefined, { 'x-customer-key': device }), { id: s.order.id });
  check("tracking: a stranger's device key does not open the order: 404", t.status === 404, t);

  // no job: not live
  const noJob = await (async () => {
    const customer = crypto.randomUUID();
    const order = must(await d.from('ol_orders').insert({ customer_hash: await sha256(`user:${customer}`), idempotency_key: `zz-test-live-order-nojob-${crypto.randomUUID().slice(0, 8)}`, items: [{ id: 'x', name: 'ZZ-TEST', qty: 1, price: 1 }], subtotal: 1, total: 1, eta_minutes: 30 }).select('*'))[0];
    orderIds.push(order.id); return { customer, order };
  })();
  t = await trackOf(noJob);
  check('tracking: an order with no delivery job is not live (the app keeps its simulation); only the phase is real', t.status === 200 && t.body.live === false && t.body.phase === 'preparing' && t.body.rider === null && t.body.eta === null && t.body.route === null && t.body.store === null && t.body.drop === null && t.body.poll_after_s === 30, t);
  const device2 = `zz-test-device-${crypto.randomUUID()}`.slice(0, 40);
  const memId = crypto.randomUUID();
  const memStore = (globalThis as any).__onecityStore;
  memStore.orders.push({ id: memId, customer: await sha256(device2), status: 'placed' });
  const savedUrl = process.env.SUPABASE_URL; process.env.SUPABASE_URL = '';
  try {
    t = await go(routeTracking.GET, req(null, `orders/${memId}/tracking`, 'GET', undefined, { 'x-customer-key': device2 }), { id: memId });
    const t2 = await go(routeTracking.GET, req(null, `orders/${memId}/tracking`, 'GET', undefined, { 'x-customer-key': `zz-test-device-${crypto.randomUUID()}`.slice(0, 40) }), { id: memId });
    check('tracking: memory/demo mode (no database): the owner gets live:false, anyone else 404', t.status === 200 && t.body.live === false && t.body.phase === 'preparing' && t2.status === 404, { t, t2 });
  } finally { process.env.SUPABASE_URL = savedUrl; memStore.orders.splice(memStore.orders.findIndex((o: any) => o.id === memId), 1); }

  // before a rider: the promise
  fresh();
  const promisedAt = Date.now() + 33 * 60_000;
  s = await scenario({ status: 'created', rider: null, job: { released_at: null, prep_minutes: null }, order: { promised_eta_at: iso(promisedAt), status: 'placed' } });
  t = await trackOf(s);
  check('tracking: restaurant has not accepted yet: phase "preparing", rider null, ETA is the promise (promised_eta_at)', t.status === 200 && t.body.live === true && t.body.phase === 'preparing' && t.body.rider === null && t.body.route === null
    && t.body.eta.source === 'promise' && t.body.eta.minutes === 33 && t.body.eta.arrives_at === iso(promisedAt) && t.body.poll_after_s === 30, t);
  check('tracking: the store and the drop pin are given to the owner of the order', t.body.store.lat === S.lat && t.body.store.lng === S.lng && t.body.store.name === 'ZZ-TEST Kitchen' && t.body.drop.lat === D.lat && t.body.drop.lng === D.lng, t.body);
  s = await scenario({ status: 'offered', rider: null, order: { promised_eta_at: iso(promisedAt) } });
  t = await trackOf(s);
  check('tracking: accepted, no rider yet: phase "finding_rider", still the promise', t.status === 200 && t.body.phase === 'finding_rider' && t.body.rider === null && t.body.eta.source === 'promise' && googleCalls.length === 0, t);
  const created = Date.now() - 5 * 60_000;
  const legacy = tracking.promiseEta({ promised_eta_at: null, created_at: iso(created), eta_minutes: 25 }, Date.now());
  check('promise: an order with no promised_eta_at uses created_at + eta_minutes', legacy?.source === 'promise' && legacy.minutes === 20 && legacy.arrives_at === iso(created + 25 * 60_000), legacy);
  check('promise: nothing to go on gives no ETA; a promise already passed shows 1 minute, never 0 or a past time',
    tracking.promiseEta({ promised_eta_at: null, created_at: iso(), eta_minutes: null }, Date.now()) === null && (() => { const e = tracking.promiseEta({ promised_eta_at: iso(Date.now() - 600_000) }, Date.now())!; return e.minutes === 1 && Date.parse(e.arrives_at) > Date.now(); })());
  check('phase: every status the database can hold maps to one of the eight phases',
    ([['assigned', 'to_store'], ['at_pickup', 'at_store'], ['picked_up', 'on_the_way'], ['at_drop', 'at_door'], ['delivered', 'delivered'], ['cancelled', 'cancelled']] as const).every(([st, ph]) => tracking.phaseOf('accepted', { status: st }) === ph)
    && tracking.phaseOf('cancelled', { status: 'assigned' }) === 'cancelled' && tracking.phaseOf('delivered', { status: 'picked_up' }) === 'delivered');

  // rider on the way to the store
  fresh();
  await setPosition(rA, R0);
  s = await scenario({ status: 'assigned', step: 'to_pickup', job: { released_at: iso(Date.now() - 5 * 60_000), prep_minutes: 20 } });
  t = await trackOf(s);
  const rideS = roadSeconds(S, D), toStoreS = roadSeconds(R0, S);
  const prepLeft = 15 * 60;
  check('tracking: rider assigned, food not ready: ETA = the LATER of (rider to store, prep left) + store to customer, source "road"',
    t.status === 200 && t.body.phase === 'to_store' && t.body.eta.source === 'road' && t.body.eta.minutes >= minutesFor(Math.max(toStoreS, prepLeft - 4) + rideS) && t.body.eta.minutes <= minutesFor(Math.max(toStoreS, prepLeft) + rideS), { got: t.body.eta, want: minutesFor(Math.max(toStoreS, prepLeft) + rideS) });
  check('tracking: the rider is shown with a first name, vehicle, position and freshness, and nothing that identifies them', t.body.rider.first_name === 'ZZ-TEST' && t.body.rider.vehicle === 'bike' && t.body.rider.lat === R0.lat && t.body.rider.lng === R0.lng && t.body.rider.stale === false && typeof t.body.rider.seen_at === 'string'
    && !Object.keys(t.body.rider).some(k => /phone|id$|^id/i.test(k)) && !t.text.includes(rA) && !t.text.includes('9888800001') && !t.text.includes('+91'), t.body.rider);
  check('tracking: the route is the rider to the store and ends at the store; two Google calls (rider to store, store to customer)', typeof t.body.route.polyline === 'string' && near(geo.decodePolyline(t.body.route.polyline).slice(-1)[0].lat, S.lat, 1e-5) && googleCalls.length === 2, { calls: googleCalls.length });
  for (let i = 0; i < 12; i++) t = await trackOf(s);
  check('tracking: twelve more polls cost no more Google calls', t.status === 200 && googleCalls.length === 2, googleCalls.length);

  fresh();
  s = await scenario({ status: 'assigned', step: 'to_pickup', job: { released_at: iso(Date.now() - 30 * 60_000), prep_minutes: 5 } });
  const far = { lat: 18.4488, lng: 76.5604 };
  await setPosition(rA, far);
  t = await trackOf(s);
  const farS = roadSeconds(far, S);
  check('tracking: food already ready, rider far away: the rider\'s trip to the store sets the ETA', t.body.eta.minutes >= minutesFor(farS + rideS - 4) && t.body.eta.minutes <= minutesFor(farS + rideS), { got: t.body.eta.minutes, want: minutesFor(farS + rideS) });
  // the rider drives toward the store: the ETA falls and no new Google call is made
  const before = t.body.eta.minutes, callsBefore = googleCalls.length;
  await setPosition(rA, { lat: far.lat - (far.lat - S.lat) * 0.75, lng: far.lng });
  t = await trackOf(s);
  check('tracking: three quarters of the way to the store: ETA is shorter and there is no new Google call', t.body.eta.minutes < before && googleCalls.length === callsBefore && t.body.rider.lat > S.lat, { before, now: t.body.eta.minutes });

  // at the store
  fresh();
  await setPosition(rA, S);
  s = await scenario({ status: 'at_pickup', step: 'waiting', job: { released_at: iso(Date.now() - 2 * 60_000), prep_minutes: 12 } });
  t = await trackOf(s);
  check('tracking: rider at the store: phase "at_store", ETA = prep left + store to customer, no route to draw', t.status === 200 && t.body.phase === 'at_store' && t.body.route === null && googleCalls.length === 1
    && t.body.eta.minutes >= minutesFor(10 * 60 - 4 + rideS) && t.body.eta.minutes <= minutesFor(10 * 60 + rideS), { eta: t.body.eta, calls: googleCalls.length });

  // on the way to the customer
  fresh();
  s = await scenario({ status: 'picked_up', step: 'to_drop' });
  await setPosition(rA, S, { last_seen_at: iso(Date.now() - 30_000) });
  t = await trackOf(s);
  const toDropS = roadSeconds(S, D);
  check('tracking: picked up: phase "on_the_way", ETA = the rider to the customer only', t.body.phase === 'on_the_way' && t.body.eta.source === 'road' && t.body.eta.minutes === minutesFor(toDropS) && googleCalls.length === 1, { eta: t.body.eta, want: minutesFor(toDropS) });
  check('tracking: the route to draw ends at the customer', near(geo.decodePolyline(t.body.route.polyline).slice(-1)[0].lat, D.lat, 1e-5) && near(geo.decodePolyline(t.body.route.polyline)[0].lat, S.lat, 1e-5), t.body.route);
  // the rider app reports a position: rider_availability and the track move, the route is trimmed, the heading comes from the GPS point
  const quarter = { lat: S.lat + (D.lat - S.lat) * 0.5, lng: S.lng + (D.lng - S.lng) * 0.5 };
  r = await go(routeTrack.POST, req(uA, `rider/jobs/${s.job.id}/track`, 'POST', { points: [{ lat: quarter.lat, lng: quarter.lng, accuracy_m: 7.4, speed: 6, heading: 135, recorded_at: iso(Date.now() - 1000) }] }), { id: s.job.id });
  const t1 = await trackOf(s);
  check('tracking: after a GPS batch the customer sees the new position, its heading, a shorter ETA and a trimmed route, with no new Google call',
    r.status === 200 && near(t1.body.rider.lat, quarter.lat, 1e-9) && t1.body.rider.heading === 135 && t1.body.eta.minutes < t.body.eta.minutes && googleCalls.length === 1
    && geo.decodePolyline(t1.body.route.polyline).length < geo.decodePolyline(t.body.route.polyline).length && near(geo.decodePolyline(t1.body.route.polyline)[0].lat, quarter.lat, 2e-5), { calls: googleCalls.length, was: t.body.eta.minutes, is: t1.body.eta.minutes, was_pts: geo.decodePolyline(t.body.route.polyline).length, pts: geo.decodePolyline(t1.body.route.polyline).length, first: geo.decodePolyline(t1.body.route.polyline)[0], quarter });
  check('tracking: a moving rider is polled every 10 s', t1.body.poll_after_s === 10, t1.body.poll_after_s);
  await addTrack(s.job, rA, quarter, { speed: 0, heading: 135, recorded_at: iso(Date.now() - 500) });
  const t2 = await trackOf(s);
  check('tracking: a stationary rider is polled every 30 s', t2.body.poll_after_s === 30, t2.body.poll_after_s);
  await setPosition(rA, { lat: quarter.lat + 0.0003, lng: quarter.lng }, { last_seen_at: iso(Date.now() + 1000) });
  const t3 = await trackOf(s);
  check('tracking: a heartbeat fresher than the last GPS point wins, and then there is no heading', near(t3.body.rider.lat, quarter.lat + 0.0003, 1e-9) && t3.body.rider.heading === null, t3.body.rider);
  await setPosition(rA, quarter, { last_seen_at: iso(Date.now() - 5 * 60_000) });
  await d.from('rider_tracks').delete().eq('job_id', s.job.id);
  const t4 = await trackOf(s);
  check('tracking: a rider not heard from for 5 minutes is marked stale and polled slowly', t4.body.rider.stale === true && t4.body.poll_after_s === 30 && t4.body.eta !== null, t4.body);

  // at the door
  s = await scenario({ status: 'at_drop', step: 'arrived' });
  await setPosition(rA, D);
  t = await trackOf(s);
  check('tracking: at the door: phase "at_door", ETA 1 minute, no route, the rider is still shown', t.body.phase === 'at_door' && t.body.eta.minutes === 1 && t.body.route === null && t.body.rider !== null, t.body);

  // a problem on the way
  s = await scenario({ status: 'exception', step: 'proof', job: { exception_kind: 'unavailable', exception_from_status: 'picked_up', exception_from_step: 'to_drop' } });
  t = await trackOf(s);
  check('tracking: a job held for a problem shows the phase it was in', t.body.phase === 'on_the_way' && t.body.rider !== null, t.body);
  s = await scenario({ status: 'exception', step: 'returned', job: { exception_kind: 'refused', exception_from_status: 'at_drop', exception_from_step: 'handover' } });
  t = await trackOf(s);
  check('tracking: a delivery closed by a problem is over: no rider, no ETA, no route', t.body.phase === 'cancelled' && t.body.rider === null && t.body.eta === null && t.body.route === null, t.body);

  // finished
  s = await scenario({ status: 'delivered', step: null, job: { delivered_at: iso() }, order: { status: 'delivered' } });
  await setPosition(rA, D);
  t = await trackOf(s);
  check('tracking: delivered: no rider position, no ETA, no route (the rider is not followed once the job is over)', t.status === 200 && t.body.phase === 'delivered' && t.body.live === true && t.body.rider === null && t.body.eta === null && t.body.route === null, t.body);
  s = await scenario({ status: 'cancelled', step: null, order: { status: 'cancelled' } });
  t = await trackOf(s);
  check('tracking: cancelled: phase "cancelled", no rider, no ETA', t.body.phase === 'cancelled' && t.body.rider === null && t.body.eta === null, t.body);

  // Google problems never reach the customer
  fresh(); googleMode = 'forbidden';
  await setPosition(rA, R0);
  s = await scenario({ status: 'assigned', step: 'to_pickup', job: { released_at: iso(Date.now() - 30 * 60_000), prep_minutes: 5 } });
  t = await trackOf(s);
  check('tracking: Google refuses: 200 with an estimate ETA and an estimate route, nothing about the key', t.status === 200 && t.body.eta.source === 'estimate' && t.body.route.polyline && !t.text.includes('AIza') && !/403|PERMISSION|Routes API/.test(t.text), t);
  fresh(); delete process.env.GOOGLE_MAPS_API_KEY;
  s = await scenario({ status: 'picked_up', step: 'to_drop' });
  await setPosition(rA, S);
  t = await trackOf(s);
  check('tracking: no key configured: the ETA is an estimate (straight line x 1.35 at 20 km/h)', t.status === 200 && t.body.eta.source === 'estimate' && t.body.eta.minutes === minutesFor(Math.round((Math.round(geo.haversineM(S, D) * 1.35)) / (20_000 / 3600))) && googleCalls.length === 0, t.body.eta);
  fresh();

  // 30 a minute
  s = await scenario({ status: 'picked_up', step: 'to_drop' });
  let ok30 = 0, blocked30 = 0;
  for (let i = 0; i < 32; i++) { t = await trackOf(s); if (t.status === 200) ok30++; else if (t.status === 429) blocked30++; }
  check('tracking: 30 a minute per customer, then 429', ok30 === 30 && blocked30 === 2, { ok30, blocked30 });
  advance(61_000);

  // =============== D. recordTrack keeps rider_availability fresh ===============
  fresh();
  s = await scenario({ status: 'picked_up', step: 'to_drop', rider: rA });
  const stamp = Date.now();
  await setPosition(rA, R0, { last_seen_at: iso(stamp - 120_000), accuracy_m: 50 });
  const pt = (i: number, at = { lat: 18.4120 + i * 0.0001, lng: 76.5610 }) => ({ ...at, accuracy_m: 12.6, speed: 4, heading: 90, recorded_at: iso(stamp - 20_000 + i * 5000) });
  r = await go(routeTrack.POST, req(uA, `rider/jobs/${s.job.id}/track`, 'POST', { points: [pt(2), pt(0), pt(1)] }), { id: s.job.id });
  let av = must(await d.from('rider_availability').select('*').eq('rider_id', rA))[0];
  check('recordTrack: the online rider\'s position, accuracy and last-seen time come from the NEWEST point of the batch', r.status === 200 && r.body.stored === 3 && av.lat === 18.4122 && av.lng === 76.5610 && av.accuracy_m === 13 && av.online === true && Date.parse(av.last_seen_at) === stamp - 10_000, { av, body: r.body });
  r = await go(routeTrack.POST, req(uA, `rider/jobs/${s.job.id}/track`, 'POST', { points: [{ ...pt(0), lat: 18.5, recorded_at: iso(stamp - 60_000) }] }), { id: s.job.id });
  av = must(await d.from('rider_availability').select('*').eq('rider_id', rA))[0];
  check('recordTrack: an older batch (a delayed upload) does not move the rider backwards', r.status === 200 && av.lat === 18.4122 && Date.parse(av.last_seen_at) === stamp - 10_000, av);
  await setPosition(rB, R0, { online: false, last_seen_at: iso(stamp - 300_000) });
  const sB = await scenario({ status: 'picked_up', step: 'to_drop', rider: rB });
  r = await go(routeTrack.POST, req(uB, `rider/jobs/${sB.job.id}/track`, 'POST', { points: [pt(0)] }), { id: sB.job.id });
  av = must(await d.from('rider_availability').select('*').eq('rider_id', rB))[0];
  check('recordTrack: a rider who is offline is not switched on or moved by their track', r.status === 200 && r.body.stored === 1 && av.online === false && av.lat === R0.lat, av);
  r = await go(routeTrack.POST, req(uA, `rider/jobs/${s.job.id}/track`, 'POST', { points: [pt(3, { lat: 18.4125, lng: 76.561 }), pt(4, { lat: 28.0, lng: 76.561 })] }), { id: s.job.id });
  av = must(await d.from('rider_availability').select('*').eq('rider_id', rA))[0];
  check('recordTrack: a GPS jump that is dropped from the batch is not what the rider is moved to (the newest KEPT point is)', r.status === 200 && r.body.dropped === 1 && r.body.stored === 1 && av.lat === 18.4125, { body: r.body, av });

  // =============== E. one real call to Google ===============
  fresh();
  let realLine = 'REAL-GOOGLE: skipped (no GOOGLE_MAPS_API_KEY in .env)';
  if (REAL_KEY) {
    googleMode = 'real'; process.env.GOOGLE_MAPS_API_KEY = REAL_KEY; process.env.GOOGLE_ROUTES_TIMEOUT_MS = '25000'; // this machine reaches Google in 3 to 5 s
    const a = { lat: 18.4088, lng: 76.5604 }, b = { lat: 18.4, lng: 76.57 };
    try {
      const real = await routing.fetchGoogleRoute(a, b);
      const pts = geo.decodePolyline(real.polyline);
      const ok = real.source === 'google' && real.distance_m > 500 && real.distance_m < 5000 && real.duration_s > 0 && pts.length >= 2 && real.steps.length > 0 && real.steps.every(st => typeof st.instruction === 'string' && Number.isFinite(st.end.lat));
      check('REAL Google Routes API (two-wheeler, traffic aware): a route came back with a polyline and turn-by-turn steps', ok, { distance_m: real.distance_m, steps: real.steps.length });
      realLine = `REAL-GOOGLE: HTTP 200, Routes API is enabled for this key. distance_m=${real.distance_m} duration_s=${real.duration_s} polyline_points=${pts.length} steps=${real.steps.length} first_step="${real.steps[0]?.instruction}" maneuver=${real.steps[0]?.maneuver}`;
    } catch (e: any) {
      const detail = String(e?.detail ?? e?.message ?? e).split(REAL_KEY).join('[hidden]');
      realLine = `REAL-GOOGLE: FAILED reason=${e?.reason ?? 'error'} http_status=${e?.status ?? 'none'} detail=${detail}`;
      if (process.env.REQUIRE_REAL_GOOGLE === '1') check('REAL Google Routes API call', false, realLine);
    }
    googleMode = 'ok'; process.env.GOOGLE_MAPS_API_KEY = FAKE_KEY; delete process.env.GOOGLE_ROUTES_TIMEOUT_MS;
  }

  // =============== the key never reached a log ===============
  check('no log line written during these checks contains a Google key', logged.every(l => !l.includes(FAKE_KEY) && (!REAL_KEY || !l.includes(REAL_KEY)) && !/AIza[0-9A-Za-z_-]{20,}/.test(l)));

  await cleanup(true);
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(realLine);
  if (!REAL_KEY || realLine.includes('FAILED')) console.log('(the real-call line above is informational: the estimate fallback is covered by the checks that ran with Google refusing or the key absent)');
}
main().catch(e => { console.error(e); process.exit(1); });
