/* Live order tracking on the order screen (spec: specs/live-navigation-eta/spec.md).
 *
 * Nothing here touches the database or the real tracking endpoint: `GET /api/orders/:id` and
 * `GET /api/orders/:id/tracking` are answered by page.route(), and the tracking answer is a script of frames
 * (rider moving store -> door, ETA changing, stale GPS, door, delivered). Google Maps is blocked so the screen
 * draws the real coordinates itself (the no-map drawing, tracking-schematic.tsx); that is what makes the rider marker
 * measurable in the DOM. A separate test (when TRACKING_SHOTS_DIR is set) opens the real Google map instead.
 *
 * Run against a dev server on any port:
 *   E2E_BASE_URL=http://localhost:8092 npx playwright test e2e/live-tracking.spec.ts
 *   TRACKING_SHOTS_DIR=/path/to/dir ...   also saves screenshots (taken only after spinners are gone and fonts are in)
 */
import fs from 'fs';
import path from 'path';
import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures';
import { encodePolyline } from '../src/utils/polyline';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8081';
const SHOTS = process.env.TRACKING_SHOTS_DIR;
test.use({ baseURL: BASE });
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const ORDER_ID = '7d3c1e52-6b0e-4a39-9d0b-2f4c9a1e8b77';
const STORE = { lat: 18.4, lng: 76.55, name: 'Fresh Mart' };
const DROP = { lat: 18.42, lng: 76.57 };
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const ORDER = {
  id: ORDER_ID, checkout_id: null, store_id: 'store-fresh-mart', store_name: STORE.name,
  address: { label: 'Home', text: '12 Gandhi Chowk, Latur', lat: DROP.lat, lng: DROP.lng, notes: '' },
  items: [{ id: 'tomato-500', name: 'Fresh Tomatoes', weight: '500 g', price: 40, mrp: 50, image: PIXEL, qty: 2 }],
  subtotal: 80, discount: 0, delivery_fee: 20, gst: 0, total: 100, coupon_code: null,
  payment_method: 'cod', payment_status: 'not_charged', status: 'accepted',
  rider_name: 'Sample rider', rider_phone: '', eta_minutes: 10, created_at: new Date(Date.now() - 4 * 60_000).toISOString(),
};

type Pt = { lat: number; lng: number };
const rider = (p: Pt, heading: number | null, over: Record<string, unknown> = {}) => ({ first_name: 'Ravi', vehicle: 'bike', ...p, heading, seen_at: new Date().toISOString(), stale: false, ...over });
const eta = (minutes: number, source: 'road' | 'estimate' | 'promise') => ({ minutes, source, arrives_at: new Date(Date.now() + minutes * 60_000).toISOString(), updated_at: new Date().toISOString() });
const frame = (phase: string, over: Record<string, unknown> = {}) => ({ live: true, phase, rider: null, store: STORE, drop: DROP, eta: null, route: null, poll_after_s: 3, ...over });

const R1 = { lat: 18.396, lng: 76.544 }, R2 = { lat: 18.3985, lng: 76.548 }, R4 = { lat: 18.404, lng: 76.5545 }, R5 = { lat: 18.41, lng: 76.561 }, R6 = { lat: 18.4196, lng: 76.5694 };
// The script. Frame i is what the i-th request gets; the last frame repeats.
const SCRIPT = () => [
  frame('finding_rider', { eta: eta(25, 'promise') }),
  frame('to_store', { rider: rider(R1, 40), eta: eta(14, 'estimate'), route: { polyline: encodePolyline([R1, STORE]) } }),
  frame('to_store', { rider: rider(R2, 42), eta: eta(12, 'road'), route: { polyline: encodePolyline([R2, STORE]) } }),
  frame('at_store', { rider: rider(STORE, null), eta: eta(10, 'road'), route: { polyline: encodePolyline([STORE, DROP]) } }),
  frame('on_the_way', { rider: rider(R4, 46), eta: eta(9, 'road'), route: { polyline: encodePolyline([R4, R5, DROP]) } }),
  frame('on_the_way', { rider: rider(R5, 47, { stale: true }), eta: eta(6, 'road'), route: { polyline: encodePolyline([R5, DROP]) } }),
  frame('at_door', { rider: rider(R6, 50), eta: eta(1, 'road') }),
  frame('delivered', { poll_after_s: 3 }),
];

type Mock = { requests: number[]; setFrames: (f: unknown[]) => void; fail: (statuses: number[]) => void };
async function mockOrder(page: Page, opts: { blockGoogle?: boolean } = {}): Promise<Mock> {
  const requests: number[] = [];
  let frames: unknown[] = SCRIPT();
  let failures: number[] = [];
  let served = 0; // frames handed out (a scripted failure does not use one up)
  if (opts.blockGoogle !== false) await page.route(/https:\/\/(maps\.googleapis\.com|maps\.gstatic\.com|fonts\.googleapis\.com)\/.*/, route => route.abort());
  await page.route(`**/api/orders/${ORDER_ID}`, route => route.fulfill({ json: ORDER }));
  await page.route(`**/api/orders/${ORDER_ID}/tracking`, async (route: Route) => {
    requests.push(Date.now());
    const failure = failures.shift();
    if (failure) return route.fulfill({ status: failure, json: { detail: 'mock failure' } });
    return route.fulfill({ json: frames[Math.min(served++, frames.length - 1)] });
  });
  return { requests, setFrames: f => { frames = f; }, fail: s => { failures = [...s]; } };
}

const open = async (page: Page) => {
  // A returning visitor has already been asked "Where are you?" (src/components/app-shell.tsx LOCATION_ASKED_KEY).
  await page.addInitScript(() => { try { localStorage.setItem('onecity.location-asked.v1', '1'); } catch { /* storage blocked */ } });
  await page.goto(`/order/${ORDER_ID}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('order-tracking')).toBeVisible({ timeout: 150_000 });
};
const box = async (page: Page, id: string) => { const b = await page.getByTestId(id).boundingBox(); if (!b) throw new Error(`${id} has no box`); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

/** Waits until nothing is still loading, then saves the screenshot (only when TRACKING_SHOTS_DIR is set). */
async function shot(page: Page, name: string, opts: { map?: 'google' | 'fallback' } = {}) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await expect(page.getByTestId('tracking-loading')).toHaveCount(0);
  await expect(page.getByTestId('tracking-map-loading')).toHaveCount(0);
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready);
  if (opts.map === 'google') {
    await page.waitForSelector('[data-testid="tracking-map-google"] .gm-style canvas, [data-testid="tracking-map-google"] .gm-style img', { timeout: 30_000 });
    await page.waitForTimeout(4_000); // tiles
  } else if (opts.map === 'fallback') {
    await expect(page.getByTestId('tracking-map-fallback')).toBeVisible();
  }
  await page.waitForTimeout(1_200); // marker glide settles
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

test('live: the real ETA, rider and timeline replace the simulation, and the rider glides', async ({ page }) => {
  const mock = await mockOrder(page);
  await open(page);

  // Frame 0: no rider yet, ETA is the promise made at checkout -> "About", no animation notice, no fake rider.
  await expect(page.getByTestId('eta-time')).toHaveText('About 25 min', { timeout: 60_000 });
  await expect(page.getByTestId('eta-arrives-by')).toHaveText(/^Around \d{1,2}:\d{2}\s?(am|pm)$/i);
  await expect(page.getByTestId('tracking-animation-notice')).toHaveCount(0);
  await expect(page.getByTestId('tracking-sample-notice')).toHaveCount(0);
  await expect(page.getByTestId('tracking-order-ref')).toContainText('Fresh Mart');
  await expect(page.getByTestId('rider-name')).toHaveText('Finding a rider for you');
  await expect(page.getByTestId('timeline-step-finding_rider').getByTestId('timeline-now')).toBeVisible();
  await expect(page.getByText('Sample rider')).toHaveCount(0);
  await expect(page.getByTestId('tracking-map')).toBeVisible();
  await expect(page.getByTestId('tracking-map-fallback')).toBeVisible(); // Google is blocked: the real coordinates are drawn without tiles
  await expect(page.getByTestId('rider-marker')).toHaveCount(0);        // nobody to draw yet
  await expect(page.getByTestId('order-payment-method')).toContainText('pay at your door');

  // Frame 1: rider assigned, estimate -> "About 14 min", rider's first name and vehicle, marker appears.
  await expect(page.getByTestId('eta-time')).toHaveText('About 14 min', { timeout: 15_000 });
  await expect(page.getByTestId('tracking-live-source')).toContainText('may change');
  await expect(page.getByTestId('rider-name')).toHaveText('Ravi');
  await expect(page.getByTestId('rider-meta')).toHaveText('Delivering by bike');
  await expect(page.getByTestId('rider-marker')).toBeVisible();
  await expect(page.getByTestId('timeline-step-to_store').getByTestId('timeline-now')).toBeVisible();
  await expect(page.getByTestId('timeline-now')).toHaveText('Ravi is heading to the store');
  await expect(page.getByTestId('tracking-route')).toBeVisible();
  await expect(page.getByTestId('call-rider-btn')).toBeVisible();
  const heroBefore = await page.getByTestId('eta-card').boundingBox();

  // Frame 2: road ETA -> exact, "Arrives by". The marker travels towards the new fix (it does not jump).
  await expect(page.getByTestId('eta-time')).toHaveText('12 min', { timeout: 15_000 });
  await expect(page.getByTestId('eta-arrives-by')).toHaveText(/^Arrives by \d{1,2}:\d{2}\s?(am|pm)$/i);
  await expect(page.getByTestId('tracking-live-source')).toContainText('Live GPS and traffic');
  const samples: { x: number; y: number }[] = [];
  for (let i = 0; i < 8; i++) { samples.push(await box(page, 'rider-marker')); await page.waitForTimeout(350); }
  const distinct = new Set(samples.map(s => `${Math.round(s.x)},${Math.round(s.y)}`));
  expect(distinct.size, `rider marker positions while gliding: ${[...distinct].join(' ')}`).toBeGreaterThanOrEqual(4);
  const heroAfter = await page.getByTestId('eta-card').boundingBox();
  expect(Math.round(heroAfter!.height), 'ETA card keeps its height when the wording changes').toBe(Math.round(heroBefore!.height));

  // Frames 3-4: at the store, then on the way. The rider ends up well away from where it was at frame 1.
  const atFirstFix = samples[0]!;
  await expect(page.getByTestId('timeline-step-at_store').getByTestId('timeline-now')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('timeline-now')).toHaveText('Ravi is at the store picking up your order');
  await expect(page.getByTestId('timeline-step-on_the_way').getByTestId('timeline-now')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('eta-time')).toHaveText('9 min');
  await page.waitForTimeout(3_500);
  const later = await box(page, 'rider-marker');
  expect(Math.hypot(later.x - atFirstFix.x, later.y - atFirstFix.y), 'the marker moved on the map').toBeGreaterThan(20);

  // Frame 5: stale GPS hint.
  await expect(page.getByTestId('tracking-stale-hint')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('tracking-stale-hint')).toContainText('out of date');
  await expect(page.getByTestId('eta-time')).toHaveText('6 min');

  // Frame 6: at the door. Frame 7: delivered, and polling stops.
  await expect(page.getByTestId('eta-time')).toHaveText('At your door', { timeout: 15_000 });
  await expect(page.getByTestId('tracking-stale-hint')).toHaveCount(0);
  await expect(page.getByTestId('eta-time')).toHaveText('Delivered', { timeout: 15_000 });
  await expect(page.getByTestId('timeline-step-delivered').getByTestId('timeline-now')).toBeVisible();
  await expect(page.getByTestId('timeline-now')).toHaveText('Delivered. Enjoy!');
  await expect(page.getByTestId('rider-marker')).toHaveCount(0);
  const seen = mock.requests.length;
  await page.waitForTimeout(8_000);
  expect(mock.requests.length, 'no more requests once the order is delivered').toBe(seen);

  // The old testIDs the rest of the suite relies on are still there.
  for (const id of ['tracking-map', 'delivery-help', 'call-rider-btn', 'continue-shopping']) {
    if (id === 'delivery-help') { await page.getByTestId('call-rider-btn').click(); await expect(page.getByTestId('delivery-help')).toContainText('kept private'); }
    else await expect(page.getByTestId(id)).toBeVisible();
  }
});

test('live: a cancelled order shows one cancelled row and stops polling', async ({ page }) => {
  const mock = await mockOrder(page);
  mock.setFrames([frame('cancelled')]);
  await open(page);
  await expect(page.getByTestId('eta-time')).toHaveText('Order cancelled', { timeout: 60_000 });
  await expect(page.getByTestId('timeline-step-cancelled')).toBeVisible();
  await expect(page.getByTestId('timeline-step-preparing')).toHaveCount(0);
  await expect(page.getByTestId('timeline-now')).toHaveText('This order was cancelled');
  const seen = mock.requests.length;
  await page.waitForTimeout(5_000);
  expect(mock.requests.length).toBe(seen);
});

test('not live: the illustrative simulation and its notice stay exactly as they were', async ({ page }) => {
  const mock = await mockOrder(page);
  mock.setFrames([{ live: false, poll_after_s: 30 }]);
  await open(page);
  await expect(page.getByTestId('tracking-animation-notice')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('tracking-animation-notice')).toHaveText(/Illustrative route/);
  await expect(page.getByTestId('eta-time')).toHaveText(/^\d+:\d{2}$/);
  await expect(page.getByTestId('tracking-sample-notice')).toContainText('Sample tracking');
  await expect(page.getByText('Sample rider').first()).toBeVisible();
  await expect(page.getByTestId('rider-marker')).toBeVisible();
  await expect(page.getByTestId('tracking-map-fallback')).toHaveCount(0);
  await shot(page, 'not-live-illustrative');
});

test('tracking endpoint unreachable (404): no error screen, the simulation runs, no request storm', async ({ page }) => {
  const mock = await mockOrder(page);
  mock.fail([404, 404, 404]);
  await open(page);
  await expect(page.getByTestId('tracking-animation-notice')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('tracking-error')).toHaveCount(0);
  await expect(page.getByTestId('eta-time')).toHaveText(/^\d+:\d{2}$/);
  const stamps = mock.requests;
  // The retry after the first failure waits about 5 s, the next about 10 s (exponential backoff, +-10 % jitter).
  await expect.poll(() => stamps.length, { timeout: 40_000 }).toBeGreaterThanOrEqual(3);
  const gap1 = stamps[1]! - stamps[0]!, gap2 = stamps[2]! - stamps[1]!;
  expect(gap1, `first retry gap ${gap1} ms`).toBeGreaterThan(4_000);
  expect(gap1).toBeLessThan(7_500);
  expect(gap2, `second retry gap ${gap2} ms`).toBeGreaterThan(8_500);
  expect(gap2).toBeLessThan(13_000);
  // Once the endpoint answers, the screen switches from the simulation to the live view by itself.
  await expect(page.getByTestId('eta-time')).toHaveText('About 25 min', { timeout: 40_000 });
  await expect(page.getByTestId('tracking-animation-notice')).toHaveCount(0);
});

test('polling pauses while the app is in the background and resumes with one request', async ({ page }) => {
  const mock = await mockOrder(page);
  await open(page);
  await expect(page.getByTestId('eta-time')).toHaveText('About 25 min', { timeout: 60_000 });
  const setVisibility = (state: 'hidden' | 'visible') => page.evaluate(s => {
    Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
    Object.defineProperty(document, 'hidden', { value: s === 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
  await setVisibility('hidden');
  await page.waitForTimeout(500);
  const whenHidden = mock.requests.length;
  await page.waitForTimeout(8_000); // more than two poll intervals
  expect(mock.requests.length, 'no requests while hidden').toBe(whenHidden);
  await setVisibility('visible');
  await expect.poll(() => mock.requests.length, { timeout: 5_000 }).toBe(whenHidden + 1);
});

test('screenshots: live view with the fallback drawing, Hindi, and the real Google map when it loads', async ({ page }) => {
  test.skip(!SHOTS, 'set TRACKING_SHOTS_DIR to save screenshots');
  const mock = await mockOrder(page);
  mock.setFrames([SCRIPT()[2]!]); // the road ETA, rider on the way to the store
  await open(page);
  await expect(page.getByTestId('eta-time')).toHaveText('12 min', { timeout: 60_000 });
  await shot(page, 'live-fallback-drawing', { map: 'fallback' });
  await page.getByTestId('tracking-map').scrollIntoViewIfNeeded();
  await shot(page, 'live-fallback-drawing-map', { map: 'fallback' });

  mock.setFrames([SCRIPT()[5]!]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('tracking-stale-hint')).toBeVisible({ timeout: 60_000 });
  await shot(page, 'live-stale-gps', { map: 'fallback' });

  mock.setFrames([SCRIPT()[1]!]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('eta-time')).toHaveText('About 14 min', { timeout: 60_000 });
  await shot(page, 'live-estimate-about', { map: 'fallback' });
});

test('screenshots: Hindi layout', async ({ page }) => {
  test.skip(!SHOTS, 'set TRACKING_SHOTS_DIR to save screenshots');
  await page.addInitScript(() => { try { localStorage.setItem('onecity.language.v1', JSON.stringify({ locale: 'hi', confirmed: true })); } catch { /* storage blocked */ } });
  const mock = await mockOrder(page);
  mock.setFrames([SCRIPT()[1]!]);
  await open(page);
  await expect(page.getByTestId('eta-time')).toContainText('लगभग', { timeout: 60_000 });
  await shot(page, 'live-hindi-estimate', { map: 'fallback' });
});

test('screenshots: real Google map', async ({ page }) => {
  test.skip(!SHOTS, 'set TRACKING_SHOTS_DIR to save screenshots');
  const mock = await mockOrder(page, { blockGoogle: false });
  mock.setFrames([SCRIPT()[4]!]);
  await open(page);
  await expect(page.getByTestId('eta-time')).toHaveText('9 min', { timeout: 60_000 });
  const google = await page.getByTestId('tracking-map-google').count();
  if (google === 0) {
    // No key in this environment, or Google refused it: the drawing was shown instead (that is the designed fallback).
    await shot(page, 'live-no-google-fallback', { map: 'fallback' });
    return;
  }
  await shot(page, 'live-google-map', { map: 'google' });
});
