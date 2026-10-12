// Pure-function checks for the live order tracking UI: no phone, no network, no React Native. They cover the encoded
// polyline decoder, the rider glide (interpolation, heading, snap), the response parser, the ETA wording (through the
// real English and Hindi catalogues and the real formatter), phase -> timeline row and Live Activity step, the polling
// delay with its backoff, and the map framing / no-map projection.
// Run from frontend/:  npx tsx scripts/tracking-ui-checks.ts
import { applyLocale, createI18n } from '../src/i18n/core';
import { makeFormatter } from '../src/i18n/format';
import { localeMeta } from '../src/i18n/locales';
import { decodePolyline, encodePolyline } from '../src/utils/polyline';
import {
  activityStepFor, bearingDeg, boundsContain, boundsOf, clampPollS, describeEta, framePoints, glideDurationMs, glideFix, glideT, haversineM,
  isTerminalPhase, lerp, lerpAngle, lerpLatLng, LIVE_TIMELINE, makeProjector, MAX_BACKOFF_MS, nextPollDelayMs, normalizeHeading, parseTracking,
  riderInitial, shouldRefit, SNAP_DISTANCE_M, timelineIndex, TRACKING_PHASES, vehicleCode, type TrackingEta, type TrackingPhase,
} from '../src/utils/tracking';
import { etaCopy } from '../src/utils/tracking-copy';

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => {
  if (!ok) { console.error('FAIL ', what, detail === undefined ? '' : JSON.stringify(detail)); process.exitCode = 1; } else { passed++; console.log('ok   ', what); }
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

async function main() {
  // ---------- polyline decoder ----------
  // The worked example from Google's "Encoded Polyline Algorithm Format" page.
  const GOOGLE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
  const decoded = decodePolyline(GOOGLE);
  check('decoder: Google\'s documented example gives its 3 points', decoded.length === 3 && near(decoded[0]!.lat, 38.5) && near(decoded[0]!.lng, -120.2) && near(decoded[1]!.lat, 40.7) && near(decoded[1]!.lng, -120.95) && near(decoded[2]!.lat, 43.252) && near(decoded[2]!.lng, -126.453), decoded);
  check('encoder: the same 3 points give Google\'s documented string', encodePolyline(decoded) === GOOGLE, encodePolyline(decoded));
  const latur = [{ lat: 18.40834, lng: 76.56037 }, { lat: 18.40912, lng: 76.56101 }, { lat: 18.41, lng: 76.55988 }, { lat: 18.40999, lng: 76.55988 }, { lat: -33.86785, lng: 151.20732 }, { lat: -0.00001, lng: -179.99999 }];
  const back = decodePolyline(encodePolyline(latur));
  check('round trip: encode then decode returns every point to 5 decimals (incl. negative and far-apart ones)', back.length === latur.length && back.every((p, i) => near(p.lat, latur[i]!.lat, 1e-5) && near(p.lng, latur[i]!.lng, 1e-5)), back);
  const six = decodePolyline(encodePolyline([{ lat: 18.408341, lng: 76.560372 }], 6), 6);
  check('decoder: precision 6 is honoured', six.length === 1 && near(six[0]!.lat, 18.408341, 1e-6) && near(six[0]!.lng, 76.560372, 1e-6), six);
  check('decoder: empty, non-string and garbage input give no points and never throw', decodePolyline('').length === 0 && decodePolyline(undefined).length === 0 && decodePolyline(42 as never).length === 0 && decodePolyline(' \n\t').length === 0);
  const cut = decodePolyline(GOOGLE.slice(0, GOOGLE.length - 4));
  check('decoder: a truncated string keeps the points that were complete', cut.length === 2 && near(cut[1]!.lat, 40.7), cut);
  check('decoder: one point only is fine', decodePolyline(encodePolyline([{ lat: 1, lng: 2 }])).length === 1);
  const long = Array.from({ length: 2000 }, (_, i) => ({ lat: 18.4 + i * 0.00005, lng: 76.56 + Math.sin(i / 40) * 0.001 }));
  const longBack = decodePolyline(encodePolyline(long));
  check('decoder: 2000 points survive intact', longBack.length === 2000 && near(longBack[1999]!.lat, long[1999]!.lat, 1e-5));

  // ---------- interpolation ----------
  check('lerp: ends and middle', lerp(10, 20, 0) === 10 && lerp(10, 20, 1) === 20 && lerp(10, 20, 0.5) === 15);
  const mid = lerpLatLng({ lat: 18, lng: 76 }, { lat: 19, lng: 77 }, 0.25);
  check('lerpLatLng: a quarter of the way', near(mid.lat, 18.25) && near(mid.lng, 76.25), mid);
  check('lerpAngle: 350 to 10 goes through 0 (the short way), not through 180', near(lerpAngle(350, 10, 0.5), 0) || near(lerpAngle(350, 10, 0.5), 360), lerpAngle(350, 10, 0.5));
  check('lerpAngle: 10 to 350 goes back through 0', near(lerpAngle(10, 350, 0.5), 0) || near(lerpAngle(10, 350, 0.5), 360), lerpAngle(10, 350, 0.5));
  check('lerpAngle: 80 to 100 passes 90; results stay in [0,360)', near(lerpAngle(80, 100, 0.5), 90) && [0, 0.3, 1].every(t => { const v = lerpAngle(350, 10, t); return v >= 0 && v < 360; }));
  check('glideT: clamps to 0..1; zero or negative duration means "already there"', glideT(-5, 1000) === 0 && glideT(500, 1000) === 0.5 && glideT(5000, 1000) === 1 && glideT(10, 0) === 1 && glideT(10, -3) === 1);
  check('glideDurationMs: about one poll interval, kept between 1 s and 20 s', glideDurationMs(10) === 10_000 && glideDurationMs(0.2) === 1_000 && glideDurationMs(300) === 20_000);
  const A = { lat: 18.4, lng: 76.56 }, B = { lat: 18.401, lng: 76.56 }; // B is 111 m due north of A
  check('haversine: 0.001 degree of latitude is about 111 m', Math.abs(haversineM(A, B) - 111.2) < 1, haversineM(A, B));
  check('bearing: due north 0, due east 90, due south 180, due west 270', near(bearingDeg(A, B), 0, 1e-6) && Math.abs(bearingDeg(A, { lat: 18.4, lng: 76.57 }) - 90) < 0.1 && near(bearingDeg(B, A), 180, 1e-6) && Math.abs(bearingDeg(A, { lat: 18.4, lng: 76.55 }) - 270) < 0.1);
  const g0 = glideFix({ ...A, heading: 90 }, { ...B, heading: 90 }, 0), g1 = glideFix({ ...A, heading: 90 }, { ...B, heading: 90 }, 1), gh = glideFix({ ...A, heading: 90 }, { ...B, heading: 90 }, 0.5);
  check('glideFix: start is the old fix, end is the new fix, middle is between', near(g0.lat, A.lat) && near(g1.lat, B.lat) && gh.lat > A.lat && gh.lat < B.lat && near(gh.heading!, 90), { g0, gh, g1 });
  const derived = glideFix({ ...A, heading: null }, { ...B, heading: null }, 1);
  check('glideFix: no heading from the server -> the direction it moved in (north = 0)', derived.heading !== null && Math.abs(((derived.heading + 180) % 360) - 180) < 0.01, derived);
  const still = glideFix({ ...A, heading: 123 }, { ...A, heading: null }, 1);
  check('glideFix: no heading and no movement -> keeps the old heading', still.heading === 123, still);
  check('glideFix: unknown heading stays unknown until a direction is known', glideFix({ ...A, heading: null }, { ...A, heading: null }, 1).heading === null);
  check('SNAP_DISTANCE_M is a few kilometres at most (a re-sync, not riding)', SNAP_DISTANCE_M >= 500 && SNAP_DISTANCE_M <= 5000);
  check('normalizeHeading: folds into [0,360), rejects non-numbers', normalizeHeading(-90) === 270 && normalizeHeading(725) === 5 && normalizeHeading('x') === null && normalizeHeading(NaN) === null && normalizeHeading(null) === null);

  // ---------- parsing the response ----------
  const goodBody = {
    live: true, phase: 'on_the_way',
    rider: { first_name: ' Ravi ', vehicle: 'bike', lat: 18.41, lng: 76.56, heading: -10, seen_at: '2026-10-08T10:00:00Z', stale: false },
    store: { lat: 18.4, lng: 76.55, name: 'Fresh Mart' }, drop: { lat: 18.42, lng: 76.57 },
    eta: { minutes: 12, arrives_at: '2026-10-08T10:12:00Z', source: 'road', updated_at: '2026-10-08T10:00:00Z' },
    route: { polyline: GOOGLE }, poll_after_s: 10,
  };
  const p1 = parseTracking(goodBody);
  check('parse: a good live response is accepted and cleaned (name trimmed, heading folded)', !!p1 && p1.live && p1.phase === 'on_the_way' && p1.rider?.first_name === 'Ravi' && p1.rider.heading === 350 && p1.eta?.minutes === 12 && p1.route?.polyline === GOOGLE && p1.store.name === 'Fresh Mart', p1);
  const p2 = parseTracking({ live: false, poll_after_s: 30 });
  check('parse: live false stays not live and keeps the poll interval', !!p2 && p2.live === false && p2.poll_after_s === 30, p2);
  check('parse: not an object, or live with an unknown phase / missing coordinates -> null (screen behaves as not live)', parseTracking(null) === null && parseTracking('x') === null && parseTracking([]) === null
    && parseTracking({ ...goodBody, phase: 'teleporting' }) === null && parseTracking({ ...goodBody, store: { lat: 'x', lng: 1 } }) === null && parseTracking({ ...goodBody, drop: undefined }) === null && parseTracking({ ...goodBody, drop: { lat: 91, lng: 0 } }) === null);
  const p3 = parseTracking({ ...goodBody, rider: { first_name: '', lat: 1, lng: 2 }, eta: { minutes: -4, arrives_at: 'nope', source: 'magic' }, route: { polyline: '' } });
  check('parse: a damaged rider / eta / route is dropped, the rest is kept', !!p3 && p3.live && p3.rider === null && p3.eta === null && p3.route === null && p3.phase === 'on_the_way', p3);
  const p4 = parseTracking({ ...goodBody, rider: null, eta: null, route: null, phase: 'finding_rider', poll_after_s: 'soon' });
  check('parse: no rider / eta / route is normal; a bad poll_after_s becomes the default', !!p4 && p4.live && p4.rider === null && p4.eta === null && p4.poll_after_s === 10, p4);
  check('parse: every contract phase is known', ['preparing', 'finding_rider', 'to_store', 'at_store', 'on_the_way', 'at_door', 'delivered', 'cancelled'].every(p => TRACKING_PHASES.includes(p as TrackingPhase)) && TRACKING_PHASES.length === 8);

  // ---------- ETA wording ----------
  const road: TrackingEta = { minutes: 12, arrives_at: '2026-10-08T14:15:00.000Z', source: 'road', updated_at: '2026-10-08T14:03:00.000Z' }; // 19:45 in India
  check('describeEta: road is exact, estimate and promise are approximate', ((v) => v.kind === 'eta' && !v.approx)(describeEta(road, 'on_the_way'))
    && ((v) => v.kind === 'eta' && v.approx)(describeEta({ ...road, source: 'estimate' }, 'to_store')) && ((v) => v.kind === 'eta' && v.approx)(describeEta({ ...road, source: 'promise' }, 'preparing')));
  check('describeEta: no ETA -> unknown; at_door / delivered / cancelled win over any ETA', describeEta(null, 'finding_rider').kind === 'unknown' && describeEta(road, 'at_door').kind === 'at_door' && describeEta(road, 'delivered').kind === 'delivered' && describeEta(null, 'cancelled').kind === 'cancelled');

  const i18n = createI18n();
  await applyLocale(i18n, 'hi', await localeMeta('hi').load());
  const words = async (lng: 'en' | 'hi', eta: TrackingEta | null, phase: TrackingPhase) => {
    await i18n.changeLanguage(lng);
    const t = i18n.getFixedT(lng) as never;
    return etaCopy(describeEta(eta, phase), t, makeFormatter({ lng, t }));
  };
  const roadEn = await words('en', road, 'on_the_way');
  check('wording en: road reads "12 min" with "Arrives by 7:45 pm" and no "About"', roadEn.text === '12 min' && /^Arrives by 7:45\s?pm$/i.test(roadEn.when) && !/about/i.test(roadEn.text + roadEn.when) && roadEn.label === 'ARRIVING IN', roadEn);
  const estEn = await words('en', { ...road, source: 'estimate' }, 'to_store');
  check('wording en: estimate reads "About 12 min" with "Around 7:45 pm" and says it may change', estEn.text === 'About 12 min' && /^Around 7:45\s?pm$/i.test(estEn.when) && /may change/i.test(estEn.source), estEn);
  const promEn = await words('en', { ...road, source: 'promise' }, 'preparing');
  check('wording en: promise reads "About 12 min" too, with its own source line', promEn.text === 'About 12 min' && promEn.source !== estEn.source && promEn.source.length > 0, promEn);
  const longEn = await words('en', { ...road, minutes: 75 }, 'on_the_way');
  check('wording en: 75 minutes reads "1 hr 15 min"', longEn.text === '1 hr 15 min', longEn);
  const soonEn = await words('en', { ...road, minutes: 0.2 }, 'on_the_way');
  check('wording en: under a minute never reads "0 min"', soonEn.text === '1 min', soonEn);
  const unknownEn = await words('en', null, 'finding_rider');
  check('wording en: no ETA reads as working it out, no clock time', unknownEn.text === 'Working it out' && unknownEn.when === '' && unknownEn.source === '', unknownEn);
  const doorEn = await words('en', road, 'at_door'), doneEn = await words('en', null, 'delivered'), cancEn = await words('en', null, 'cancelled');
  check('wording en: at your door / delivered / cancelled read as a status with the status label', doorEn.text === 'At your door' && doneEn.text === 'Delivered' && cancEn.text === 'Order cancelled' && doorEn.label === 'ORDER STATUS' && doorEn.when === '', { doorEn, doneEn, cancEn });
  const estHi = await words('hi', { ...road, source: 'estimate' }, 'to_store');
  check('wording hi: estimate carries the Hindi "about" word and Hindi minutes', estHi.text === 'लगभग 12 मिनट' && estHi.when.includes('7:45') && /[ऀ-ॿ]/.test(estHi.when), estHi);
  const roadHi = await words('hi', road, 'on_the_way');
  check('wording hi: road is exact in Hindi (no "about")', roadHi.text === '12 मिनट', roadHi);

  // ---------- phase -> timeline ----------
  check('timeline: 7 rows in the contract order; cancelled is not a row', LIVE_TIMELINE.join() === 'preparing,finding_rider,to_store,at_store,on_the_way,at_door,delivered' && timelineIndex('cancelled') === -1);
  check('timeline: each phase maps to its own row (0..6)', LIVE_TIMELINE.every((p, i) => timelineIndex(p) === i));
  check('terminal phases: delivered and cancelled only', TRACKING_PHASES.filter(isTerminalPhase).join() === 'delivered,cancelled');
  check('Live Activity step: placed order stays "placed" until the store accepts, then "packed"', activityStepFor('preparing', 'placed') === 0 && activityStepFor('preparing', 'accepted') === 1 && activityStepFor('finding_rider', 'placed') === 0 && activityStepFor('finding_rider', 'accepted') === 1);
  check('Live Activity step: rider to store / at store = packed, on the way / at door = out, delivered = delivered, cancelled = none',
    activityStepFor('to_store') === 1 && activityStepFor('at_store', 'accepted') === 1 && activityStepFor('on_the_way') === 2 && activityStepFor('at_door') === 2 && activityStepFor('delivered') === 3 && activityStepFor('cancelled') === null);
  check('rider initial: first whole character, upper case (Latin and Devanagari)', riderInitial('ravi') === 'R' && riderInitial('  अमित ') === 'अ' && riderInitial('') === '');
  check('vehicle: known codes map, free text does not', vehicleCode('Bike') === 'bike' && vehicleCode(' scooter ') === 'scooter' && vehicleCode('cycle') === 'cycle' && vehicleCode('car') === 'car' && vehicleCode('Honda Activa') === null && vehicleCode(null) === null);

  // ---------- polling and backoff ----------
  check('poll: after a good answer, the delay is poll_after_s', nextPollDelayMs(10, 0) === 10_000 && nextPollDelayMs(30, 0) === 30_000);
  check('poll: poll_after_s is kept between 3 s and 120 s; missing = 10 s', nextPollDelayMs(0.5, 0) === 3_000 && nextPollDelayMs(9999, 0) === 120_000 && nextPollDelayMs(undefined, 0) === 10_000 && clampPollS('x') === 10);
  check('backoff: 5 s, 10 s, 20 s, 40 s, then 60 s at most (no jitter at rand 0.5)', [1, 2, 3, 4, 5, 6, 20].map(f => nextPollDelayMs(10, f, 0.5)).join() === '5000,10000,20000,40000,60000,60000,60000');
  check('backoff: always grows until the cap and never shrinks', (() => { let last = 0; for (let f = 1; f <= 12; f++) { const d = nextPollDelayMs(10, f, 0.5); if (d < last) return false; last = d; } return true; })());
  check('backoff: jitter stays within +-10 % and never beyond the cap by more than 10 %', nextPollDelayMs(10, 3, 0) === 18_000 && nextPollDelayMs(10, 3, 1) === 22_000 && nextPollDelayMs(10, 9, 1) <= MAX_BACKOFF_MS * 1.1 && nextPollDelayMs(10, 3, 5) === 22_000);
  check('backoff: a failure never uses poll_after_s (it is the error schedule)', nextPollDelayMs(120, 1, 0.5) === 5_000);

  // ---------- map framing and the no-map drawing ----------
  const store = { lat: 18.4, lng: 76.55 }, drop = { lat: 18.42, lng: 76.57 }, rider = { lat: 18.41, lng: 76.56 };
  const toStore = framePoints({ phase: 'to_store', rider, store, drop }, []);
  const onWay = framePoints({ phase: 'on_the_way', rider, store, drop }, []);
  check('frame: before pickup shows store + address + rider; after pickup drops the store', toStore.length === 3 && toStore.some(p => p.lat === store.lat) && onWay.length === 2 && !onWay.some(p => p.lat === store.lat));
  check('frame: a delivered order shows no rider', framePoints({ phase: 'delivered', rider, store, drop }, []).length === 2);
  const b = boundsOf([store, drop, rider])!;
  check('bounds: covers every point', b.south === 18.4 && b.north === 18.42 && b.west === 76.55 && b.east === 76.57 && [store, drop, rider].every(p => boundsContain(b, p)));
  const single = boundsOf([store])!;
  check('bounds: one point (or all the same) still gets a visible span', single.north - single.south >= 0.004 - 1e-9 && single.east - single.west >= 0.004 - 1e-9 && boundsOf([]) === null);
  check('refit: the first frame always fits', shouldRefit(null, b));
  const modest = boundsOf([{ lat: 18.401, lng: 76.551 }, { lat: 18.419, lng: 76.569 }], 0.0001)!;
  check('refit: the same frame, or a modest shrink inside it, does not refit (no map jitter)', !shouldRefit(b, b) && !shouldRefit(b, modest));
  const inner = boundsOf([{ lat: 18.409, lng: 76.559 }, { lat: 18.412, lng: 76.562 }], 0.0001)!;
  check('refit: something outside the frame refits', shouldRefit(inner, b));
  check('refit: everything twice as close refits (zoom in)', shouldRefit(b, inner));
  const proj = makeProjector(b, 320, 240, 24);
  const ps = proj(store), pd = proj(drop), pr = proj(rider);
  check('projector: north is up, east is right', pd.y < ps.y && pd.x > ps.x);
  check('projector: every point lands inside the box, inside the margin', [ps, pd, pr].every(p => p.x >= 24 - 1e-6 && p.x <= 296 + 1e-6 && p.y >= 24 - 1e-6 && p.y <= 216 + 1e-6), [ps, pd, pr]);
  const tall = makeProjector(boundsOf([{ lat: 18.4, lng: 76.55 }, { lat: 18.41, lng: 76.55 }], 0.0001)!, 300, 300, 20);
  const east = tall({ lat: 18.405, lng: 76.55 });
  check('projector: a thin north-south line is centred, not stretched across the width', Math.abs(east.x - 150) < 1, east);
  const dx = (pj: ReturnType<typeof makeProjector>, lat: number) => pj({ lat, lng: 0.01 }).x - pj({ lat, lng: 0 }).x;
  const dxEquator = dx(makeProjector({ south: 0, north: 0.01, west: 0, east: 0.01 }, 200, 200, 0), 0);
  const dxLat60 = dx(makeProjector({ south: 60, north: 60.01, west: 0, east: 0.01 }, 200, 200, 0), 60);
  check('projector: a degree of longitude is shortened by cos(latitude) (60 deg north: half as wide)', Math.abs(dxEquator - 200) < 0.5 && Math.abs(dxLat60 - 100) < 0.5, { dxEquator, dxLat60 });
  check('a real route survives decode -> frame -> project: all points inside the box', (() => {
    const route = decodePolyline(encodePolyline(latur.slice(0, 4)));
    const bb = boundsOf(framePoints({ phase: 'on_the_way', rider: route[0]!, store, drop: route[3]! }, route))!;
    const pj = makeProjector(bb, 340, 240, 36);
    return route.every(p => { const q = pj(p); return q.x >= 35.9 && q.x <= 304.1 && q.y >= 35.9 && q.y <= 204.1; });
  })());

  console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}`);
}
main().catch(e => { console.error(e); process.exit(1); });
