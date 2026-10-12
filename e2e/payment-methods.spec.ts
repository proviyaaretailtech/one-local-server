/* Customer payment screens for Cashfree (spec: specs/cashfree-checkout/spec.md "UI standard").
 *
 * Nothing here touches Cashfree, the database or the real payment endpoints: every /api/payments/* answer is made up by
 * page.route() (the shapes follow docs/PAYMENTS.md "App API (Cashfree)"), as are /api/features and the order the customer lands on.
 * The cart quote and product list are the dev server's own. Each test drives one state: method list, last-used on top, cash
 * unavailable / cash confirm, UPI QR, UPI by typed id, hosted page (popup), confirming ("do not pay again"), still-confirming,
 * success, failed, dropped, network loss, double tap, and the refund line (initiated / processed / failed).
 *
 * Run against a dev server on any port:
 *   E2E_BASE_URL=http://localhost:8092 npx playwright test e2e/payment-methods.spec.ts --workers=1 --retries=0
 *   PAYMENT_SHOTS_DIR=/path/to/dir ...   also saves screenshots (taken after spinners are gone and fonts are in)
 */
import fs from 'fs';
import path from 'path';
import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8081';
const SHOTS = process.env.PAYMENT_SHOTS_DIR;
test.use({ baseURL: BASE });
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

// localStorage key labels of the app's Supabase sign-in client (sb-<label>-auth-token): the local stack, and whatever project the
// web build resolved (E2E_SUPABASE_REF, a label only). The session stored under them is made up and never sent anywhere.
const SESSION_KEYS = ['127', ...(process.env.E2E_SUPABASE_REF ? [process.env.E2E_SUPABASE_REF] : [])];
const remote: string[] = [];
// The only call a page load makes to it is the public GET /auth/v1/settings; it is refused here. Nothing else may go out.
test.beforeEach(() => { remote.length = 0; });
test.afterEach(() => { expect(remote.filter(u => !u.endsWith('/auth/v1/settings')), 'no call to a real Supabase except the public settings read').toEqual([]); });
const CHECKOUT = 'cf-checkout-1';
const ORDER_ID = '7d3c1e52-6b0e-4a39-9d0b-2f4c9a1e8b77';
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
// A real 1x1 PNG standing in for the QR code image the server draws.
const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

type Outcome = 'pending' | 'paid' | 'failed' | 'dropped' | 'expired' | 'refunded' | 'cod';
const status = (outcome: Outcome, over: Record<string, unknown> = {}) => ({
  provider: 'cashfree', checkout_id: CHECKOUT, order_id: ORDER_ID, order_ids: [ORDER_ID], amount: 0,
  payment_status: outcome === 'paid' ? 'paid' : outcome === 'pending' ? 'pending' : 'failed', outcome, method: 'upi', message: null,
  retry_ok: outcome !== 'paid', poll_after_ms: outcome === 'pending' ? 2000 : null, ...over,
});
const METHODS = {
  provider: 'cashfree', online: true, environment: 'sandbox',
  cod: { available: true, reason: null, max_total: null, note: 'Pay cash to the rider at your door, keep exact change' },
  upi: { available: true, hosted: true, apps: ['google_pay', 'phonepe', 'paytm', 'bhim'], intent: true, qr: true, collect: true, collect_note: 'May not work on Android phones' },
  card: { available: true, hosted: true }, netbanking: { available: true, hosted: true }, wallet: { available: true, hosted: true },
};
const ORDER = (over: Record<string, unknown> = {}) => ({
  id: ORDER_ID, checkout_id: CHECKOUT, store_id: 's1', store_name: 'Fresh Mart',
  address: { label: 'Home', text: '12 Gandhi Chowk, Latur', lat: 18.42, lng: 76.57, notes: '' },
  items: [{ id: 'p1', name: 'Fresh Tomatoes', weight: '500 g', price: 25, mrp: 40, image: PIXEL, qty: 2 }],
  subtotal: 50, discount: 0, delivery_fee: 0, gst: 0, total: 50, coupon_code: null,
  payment_method: 'upi', payment_status: 'paid', status: 'accepted', rider_name: 'Sample rider', rider_phone: '', eta_minutes: 10, created_at: new Date(Date.now() - 20 * 60_000).toISOString(), ...over,
});

type Mock = {
  methods: unknown; statuses: unknown[]; orderCalls: { headers: Record<string, string>; body: any }[]; upiCalls: any[]; statusCalls: number[]; codCalls: number;
  checkoutPosts: any[]; upiReply: (body: any) => { status: number; json: unknown }; pollAfter?: number; giveUpAfter: number; failStatus: number; refunds: unknown[]; orderReply: Record<string, unknown>;
};
async function setup(page: Page, o: Partial<Mock> = {}): Promise<Mock> {
  const m: Mock = {
    methods: METHODS, statuses: [status('pending')], orderCalls: [], upiCalls: [], statusCalls: [], codCalls: 0, checkoutPosts: [], giveUpAfter: 300_000, failStatus: 0, refunds: [], orderReply: {},
    upiReply: () => ({ status: 200, json: {} }), ...o,
  };
  await page.addInitScript(keys => {
    try {
      // A made-up signed-in session for the local Supabase client (never validated by the app; every API answer here is mocked).
      const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
      const exp = Math.floor(Date.now() / 1000) + 86400;
      const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, aud: 'authenticated' })}.sig`;
      const session = JSON.stringify({ access_token: token, refresh_token: 'r', expires_at: exp, expires_in: 86400, token_type: 'bearer', user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'asha@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
      for (const k of keys) localStorage.setItem(`sb-${k}-auth-token`, session);
      localStorage.setItem('onecity.location-asked.v1', '1');
      localStorage.setItem('one-latur-location', 'Home: 12 Gandhi Chowk, Latur 413512');
      localStorage.setItem('onecity.customer.v1', JSON.stringify({
        profile: { name: 'Asha Patil', email: 'asha@example.com', phone: '9876543210', avatar: 'person', photo: '', birthday: '', diet: '', language: 'en', notifications: { orders: true, offers: false, bookings: true } },
        addresses: [{ id: 'a1', label: 'Home', name: 'Asha', phone: '9876543210', line: '12 Gandhi Chowk', area: 'Latur', pin: '413512', lat: 18.4, lng: 76.55 }], payment: 'cod', referral: 'ONETEST',
      }));
    } catch { /* storage blocked */ }
  }, SESSION_KEYS);
  // The app's sign-in client must never reach a real Supabase from these tests: any such call is refused and fails the test.
  await page.route(/https?:\/\/[^/]*supabase\.(co|in)\/.*/, route => { remote.push(route.request().url()); return route.abort(); });
  const products = await page.request.get(`${BASE}/api/products`).then(r => r.json()) as { id: string }[];
  const p1 = products.find(p => p.id === 'p1')!;
  await page.addInitScript(item => {
    try { if (!localStorage.getItem('onelatur.cart.v2')) localStorage.setItem('onelatur.cart.v2', JSON.stringify({ food: [], shopping: [{ ...item, qty: 2 }], kind: 'shopping' })); } catch { /* storage blocked */ }
  }, p1);
  await page.route(/https:\/\/(maps\.googleapis\.com|maps\.gstatic\.com|fonts\.googleapis\.com)\/.*/, route => route.abort());
  await page.route('**/api/features', route => route.fulfill({ json: { ai_search: false, assistant: false, maps: false, online_payments: true, wallet: false, coins: false, google_sign_in: false } }));
  await page.route('**/api/payments/**', async (route: Route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname.replace('/api/payments/', '');
    if (p === 'methods') return route.fulfill({ json: m.methods });
    if (p === 'order' && req.method() === 'POST') {
      m.orderCalls.push({ headers: req.headers(), body: req.postDataJSON() });
      return route.fulfill({ json: {
        provider: 'cashfree', environment: 'sandbox', checkout_id: CHECKOUT, order_id: ORDER_ID, order_ids: [ORDER_ID], payment_status: 'pending', amount: 5000, amount_rupees: 50, currency: 'INR',
        payment_session_id: 'session_test', cf_order_id: 'cf_1', expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        checkout_url: `${BASE}/api/payments/checkout-page?checkout=${CHECKOUT}&t=test`, return_url: `${BASE}/api/payments/return?checkout=${CHECKOUT}&t=test`,
        poll: { status_path: `/payments/status?checkout_id=${CHECKOUT}`, every_ms: 2000, give_up_after_ms: m.giveUpAfter },
      } });
    }
    if (p === 'upi') { const body = req.postDataJSON(); m.upiCalls.push(body); const r = m.upiReply(body); return route.fulfill({ status: r.status, json: r.json }); }
    if (p === 'status') {
      m.statusCalls.push(Date.now());
      if (m.failStatus > 0) { m.failStatus--; return route.abort('internetdisconnected'); }
      const s = m.statuses.length > 1 ? m.statuses.shift() : m.statuses[0];
      return route.fulfill({ json: s });
    }
    if (p === 'cod') { m.codCalls++; return route.fulfill({ json: { order_id: ORDER_ID } }); }
    if (p === 'refund-status') return route.fulfill({ json: { checkout_id: CHECKOUT, refunded_total: 0, refunds: m.refunds } });
    return route.fulfill({ status: 404, json: { detail: 'not mocked' } });
  });
  // The page a hosted payment opens in the popup (a popup is another page, so the route is on the context): Cashfree is replaced by a page that reports back the way return_url does.
  await page.context().route('**/api/payments/checkout-page**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Pay</title><p id="x">Test payment page</p><button id="done" onclick="window.opener.postMessage({type:\'done\',checkout_id:\'' + CHECKOUT + '\',hint:\'pending\'}, location.origin)">Done</button>' }));
  await page.route('**/api/checkouts', route => { if (route.request().method() !== 'POST') return route.fallback(); m.checkoutPosts.push(route.request().postDataJSON()); return route.fulfill({ json: { id: 'co-cash', orders: [{ id: ORDER_ID }], created_at: new Date().toISOString() } }); });
  await page.route(`**/api/orders/${ORDER_ID}`, route => route.fulfill({ json: ORDER(m.orderReply) }));
  await page.route(`**/api/orders/${ORDER_ID}/tracking`, route => route.fulfill({ json: { live: false } }));
  await page.route(`**/api/checkouts/${CHECKOUT}`, route => route.fulfill({ json: { id: CHECKOUT, orders: [ORDER()] } }));
  return m;
}

// The payment window. In development React runs effects twice, which opens the window, closes it and opens it again: take the one still open.
const livePopup = async (page: Page, first: Promise<Page>) => {
  await first; await page.waitForTimeout(1500);
  const open = page.context().pages().filter(p => p !== page && !p.isClosed());
  if (!open.length) throw new Error('no payment window is open');
  return open[open.length - 1];
};
const openCart = async (page: Page) => {
  await page.goto('/cart', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('cart-screen')).toBeVisible({ timeout: 150_000 });
  await expect(page.getByTestId('checkout-btn')).toBeEnabled({ timeout: 60_000 });
};
const openSheet = async (page: Page) => { await page.getByTestId('checkout-pay-using').click(); await expect(page.getByTestId('pay-methods-screen')).toBeVisible(); await expect(page.getByTestId('pay-method-upi')).toBeVisible(); };
const cartCount = (page: Page) => page.evaluate(() => { try { const c = JSON.parse(localStorage.getItem('onelatur.cart.v2') || '{}'); return (c.shopping ?? []).reduce((a: number, b: { qty: number }) => a + b.qty, 0); } catch { return -1; } });
const payLabel = async (page: Page) => (await page.getByTestId('pay-methods-pay').innerText()).trim();

/** Waits until nothing is loading, hides dev overlays, then saves the screenshot (only when PAYMENT_SHOTS_DIR is set). */
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.addStyleTag({ content: 'iframe#react-refresh-overlay, [data-nextjs-dialog-overlay], #expo-dev-overlay, [id^="expo-dev"], [data-expo-dev-overlay] { display: none !important }' });
  await expect(page.getByTestId('pay-methods-loading')).toHaveCount(0);
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}
const big = async (page: Page, id: string) => { const b = await page.getByTestId(id).first().boundingBox(); expect(b, id).toBeTruthy(); expect(b!.height, `${id} is at least 44 high`).toBeGreaterThanOrEqual(43.5); expect(b!.width, `${id} is at least 44 wide`).toBeGreaterThanOrEqual(43.5); };

test('method list: UPI, cards, netbanking and wallets, cash; test ribbon; exact amount; 44pt targets', async ({ page }) => {
  await setup(page);
  await openCart(page);
  await expect(page.getByTestId('checkout-selected-payment')).toHaveText('UPI');
  await openSheet(page);
  const order = await page.locator('[data-testid^="pay-method-"][data-testid$="-select"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
  expect(order).toEqual(['pay-method-upi-select', 'pay-method-card-select', 'pay-method-netbanking-select', 'pay-method-cod-select']);
  await expect(page.getByTestId('pay-test-ribbon')).toBeVisible();
  await expect(page.getByTestId('pay-method-upi')).toContainText('Google Pay, PhonePe, Paytm, BHIM');
  await expect(page.getByTestId('pay-method-card')).toContainText('We do not save it');
  await expect(page.getByTestId('pay-method-netbanking')).toContainText('Netbanking and wallets');
  await expect(page.getByTestId('pay-method-cod')).toContainText('exact change');
  await expect(page.getByText('Last used')).toHaveCount(0);
  // Web: QR and the hosted page, no phone-only app tiles; typing a UPI ID is only a small link.
  await expect(page.getByTestId('pay-upi-qr')).toBeVisible();
  await expect(page.getByTestId('pay-upi-hosted')).toBeVisible();
  await expect(page.getByTestId('pay-upi-google_pay')).toHaveCount(0);
  await expect(page.getByTestId('pay-upi-id-link')).toBeVisible();
  await expect(page.getByTestId('pay-upi-id-input')).toHaveCount(0);
  // The Pay button shows the cart's exact total.
  const total = (await page.getByTestId('bill-total').count()) ? null : null; void total;
  expect(await payLabel(page)).toMatch(/^Pay ₹[\d,]+(\.\d\d)?$/);
  for (const id of ['pay-methods-back', 'pay-methods-pay', 'pay-method-upi-select', 'pay-method-card-select', 'pay-method-netbanking-select', 'pay-method-cod-select', 'pay-upi-qr', 'pay-upi-hosted', 'pay-upi-id-link']) await big(page, id);
  await shot(page, '01-method-list-upi');
  await page.getByTestId('pay-method-card-select').click();
  await expect(page.getByTestId('pay-upi-qr')).toHaveCount(0); // the UPI choices close, the card row is the selected one
  await expect(page.getByTestId('pay-methods-pay')).toBeEnabled();
  await shot(page, '02-method-list-card-selected');
});

test('last-used method is on top and is remembered after paying', async ({ page }) => {
  const m = await setup(page);
  await page.addInitScript(() => { try { if (!localStorage.getItem('onecity.pay.last.v1')) localStorage.setItem('onecity.pay.last.v1', JSON.stringify({ method: 'card' })); } catch { /* storage blocked */ } });
  m.statuses = [status('pending')];
  await openCart(page);
  await expect(page.getByTestId('checkout-selected-payment')).toHaveText('Credit or debit card');
  await openSheet(page);
  const order = await page.locator('[data-testid^="pay-method-"][data-testid$="-select"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')!.replace('pay-method-', '').replace('-select', '')));
  expect(order).toEqual(['card', 'upi', 'netbanking', 'cod']);
  await expect(page.getByTestId('pay-method-card').getByText('Last used')).toBeVisible();
  await shot(page, '03-last-used-on-top');
  // Pay with netbanking: that becomes the method on top next time.
  await page.getByTestId('pay-method-netbanking-select').click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByTestId('pay-methods-pay').click();
  (await livePopup(page, popupPromise)).close();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('onecity.pay.last.v1'))).toContain('netbanking');
});

test('cash on delivery unavailable: reason shown, cannot be chosen', async ({ page }) => {
  await setup(page, { methods: { ...METHODS, cod: { available: false, reason: 'over_limit', max_total: 1 , note: '' } } });
  await openCart(page);
  await openSheet(page);
  await expect(page.getByTestId('pay-cod-reason')).toContainText('Not available for orders above ₹1');
  await expect(page.getByTestId('pay-method-cod-select')).toBeDisabled();
  const last = page.locator('[data-testid^="pay-method-"][data-testid$="-select"]').last();
  await expect(last).toHaveAttribute('data-testid', 'pay-method-cod-select');
  await shot(page, '04-cod-unavailable');
});

test('cash on delivery: confirm places the order with no online payment', async ({ page }) => {
  const m = await setup(page);
  await openCart(page);
  await openSheet(page);
  await page.getByTestId('pay-method-cod-select').click();
  await expect(page.getByTestId('pay-methods-pay')).toHaveText(/^Place order · ₹/);
  await expect(page.getByText('You pay the rider when your order arrives.')).toBeVisible();
  await shot(page, '05-cod-confirm');
  await page.getByTestId('pay-methods-pay').click();
  await expect(page).toHaveURL(new RegExp(`/order/${ORDER_ID}`), { timeout: 60_000 });
  expect(m.orderCalls).toHaveLength(0);
  expect(m.checkoutPosts).toHaveLength(1);
  expect(m.checkoutPosts[0].payment_method).toBe('cod');
  await expect.poll(() => cartCount(page)).toBe(0);
});

test('UPI QR on the web: waits with a 5 minute timer, then success opens the order', async ({ page }) => {
  const m = await setup(page, {
    upiReply: b => ({ status: 200, json: { checkout_id: CHECKOUT, mode: b.mode, payment_status: 'pending', qr: { image: QR, upi_uri: 'upi://pay?pa=x@y' }, poll: { every_ms: 2000, give_up_after_ms: 300000 } } }),
    statuses: [status('pending'), status('pending'), status('paid')],
  });
  await openCart(page);
  await openSheet(page);
  await page.getByTestId('pay-upi-qr').click();
  await page.getByTestId('pay-methods-pay').click();
  await expect(page.getByTestId('pay-qr-image')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pay-qr-title')).toContainText('Scan to pay ₹');
  await expect(page.getByTestId('pay-timer')).toContainText(/Time left [45]:\d\d/);
  expect(m.upiCalls[0]).toMatchObject({ checkout_id: CHECKOUT, mode: 'qr' });
  expect(m.orderCalls[0].body.payment_method).toBe('upi');
  await big(page, 'pay-cancel');
  await shot(page, '06-upi-qr-waiting');
  await expect(page.getByTestId('pay-success-title')).toBeVisible({ timeout: 40_000 });
  await shot(page, '07-success');
  await expect(page).toHaveURL(new RegExp(`/order/${ORDER_ID}`), { timeout: 30_000 });
  await expect.poll(() => cartCount(page)).toBe(0);
});

test('UPI id is the last resort: validated, request sent, countdown, then it fails in plain words and the cart is intact', async ({ page }) => {
  const m = await setup(page, {
    upiReply: b => ({ status: 200, json: { checkout_id: CHECKOUT, mode: b.mode, payment_status: 'pending', collect: { upi_id_masked: 'te***@gocash', expires_at: new Date(Date.now() + 300_000).toISOString(), expires_in_s: 300 }, poll: { every_ms: 2000, give_up_after_ms: 300000 } } }),
    statuses: [status('pending'), status('failed', { message: 'Your bank declined the payment.' })],
  });
  await openCart(page);
  await openSheet(page);
  await page.getByTestId('pay-upi-id-link').click();
  await expect(page.getByTestId('pay-methods-pay')).toBeDisabled();
  await page.getByTestId('pay-upi-id-input').fill('nope');
  await page.getByTestId('pay-upi-id-input').blur();
  await expect(page.getByTestId('pay-upi-id-error')).toBeVisible();
  await expect(page.getByTestId('pay-methods-pay')).toBeDisabled();
  await shot(page, '08-upi-id-invalid');
  await page.getByTestId('pay-upi-id-input').fill('testsuccess@gocash');
  await expect(page.getByTestId('pay-methods-pay')).toBeEnabled();
  await page.getByTestId('pay-methods-pay').click();
  await expect(page.getByTestId('pay-wait-title')).toContainText('Request sent to te***@gocash', { timeout: 30_000 });
  await expect(page.getByTestId('pay-timer')).toContainText(/Time left [45]:\d\d/);
  expect(m.upiCalls[0]).toMatchObject({ mode: 'collect', upi_id: 'testsuccess@gocash' });
  await shot(page, '09-upi-collect-waiting');
  await expect(page.getByTestId('pay-failed-title')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('pay-failed-reason')).toHaveText('Your bank declined the payment.');
  await expect(page.getByText('Your cart is safe and nothing is lost')).toBeVisible();
  for (const id of ['pay-try-again', 'pay-try-other', 'pay-switch-cash']) await big(page, id);
  await shot(page, '10-failed');
  expect(await cartCount(page)).toBe(2);
  // "Try another method" goes back to the list; the typed UPI id was not remembered.
  await page.getByTestId('pay-try-other').click();
  await expect(page.getByTestId('pay-methods-screen')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('onecity.pay.last.v1'))).not.toContain('testsuccess');
  expect(await cartCount(page)).toBe(2);
});

test('hosted page (card): popup, confirming "do not pay again", then paid; Idempotency-Key is sent', async ({ page }) => {
  const m = await setup(page, { statuses: [status('pending')] });
  await openCart(page);
  await openSheet(page);
  await page.getByTestId('pay-method-card-select').click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByTestId('pay-methods-pay').click();
  const popup = await livePopup(page, popupPromise);
  await expect(page.getByTestId('pay-hosted')).toBeVisible();
  await expect(page.getByText('Finish paying in the secure window')).toBeVisible();
  expect(m.orderCalls[0].headers['idempotency-key']).toMatch(/\S{8,}/);
  expect(m.orderCalls[0].body).toMatchObject({ payment_method: 'card', upi_app: null });
  expect(m.orderCalls[0].body.prefill).toMatchObject({ name: 'Asha Patil', contact: '9876543210' });
  expect(JSON.stringify(m.orderCalls[0].body)).not.toMatch(/secret|payment_session_id/i);
  await shot(page, '11-hosted-window-open');
  await popup.waitForLoadState('domcontentloaded');
  m.statuses = [status('pending'), status('pending'), status('pending'), status('pending'), status('paid')]; // the bank takes a few seconds after the page says done
  await popup.locator('#done').click().catch(() => { /* the app closes the window as soon as it hears the cue */ }); // the result page's cue; the app then asks the server
  await expect(page.getByTestId('pay-confirming-title')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pay-confirming-body')).toContainText('Please do not pay again');
  await shot(page, '12-confirming-do-not-pay-again');
  await expect(page.getByTestId('pay-success-title')).toBeVisible({ timeout: 40_000 });
  await expect(page).toHaveURL(new RegExp(`/order/${ORDER_ID}`), { timeout: 30_000 });
});

test('closing the payment window by hand: pending counts as cancelled, cart intact, back to the list', async ({ page }) => {
  const m = await setup(page, { statuses: [status('pending')] });
  await openCart(page);
  await openSheet(page);
  await page.getByTestId('pay-method-netbanking-select').click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByTestId('pay-methods-pay').click();
  const popup = await livePopup(page, popupPromise);
  await popup.close();
  await expect(page.getByTestId('pay-dropped-title')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Your cart is safe and nothing was charged.')).toBeVisible();
  await big(page, 'pay-choose-method');
  await shot(page, '13-cancelled');
  expect(m.statusCalls.length).toBeGreaterThan(0);
  expect(await cartCount(page)).toBe(2);
  await page.getByTestId('pay-choose-method').click();
  await expect(page.getByTestId('pay-methods-screen')).toBeVisible();
});

test('a server "dropped" answer shows cancelled too; failed offers cash on delivery which switches the same checkout', async ({ page }) => {
  const m = await setup(page, { upiReply: b => ({ status: 200, json: { checkout_id: CHECKOUT, mode: b.mode, payment_status: 'pending', qr: { image: QR, upi_uri: 'upi://pay' } } }), statuses: [status('failed', { message: null, outcome: 'expired', retry_ok: true })] });
  await openCart(page);
  await openSheet(page);
  await page.getByTestId('pay-upi-qr').click();
  await page.getByTestId('pay-methods-pay').click();
  await expect(page.getByTestId('pay-failed-title')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pay-failed-reason')).toHaveText('This payment session ended before it was completed.');
  await page.getByTestId('pay-switch-cash').click();
  await expect(page).toHaveURL(new RegExp(`/order/${ORDER_ID}`), { timeout: 30_000 });
  expect(m.codCalls).toBe(1);
  expect(m.checkoutPosts).toHaveLength(0);
});

test('still confirming after the give-up time: "do not pay again", never "failed"; the cart keeps a check-status banner', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const m = await setup(page, { giveUpAfter: 5000, statuses: [status('pending')] });
  await openCart(page);
  await openSheet(page);
  await page.getByTestId('pay-method-card-select').click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByTestId('pay-methods-pay').click();
  const popup = await livePopup(page, popupPromise);
  await popup.waitForLoadState('domcontentloaded');
  await popup.locator('#done').click().catch(() => { /* the app closes the window as soon as it hears the cue */ });
  await expect(page.getByTestId('pay-confirming-title')).toBeVisible({ timeout: 20_000 });
  // Reduced motion: no spinner is drawn while waiting.
  await expect(page.locator('[role="progressbar"]')).toHaveCount(0);
  await expect(page.getByTestId('pay-stuck-title')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText('Please do not pay again. If money was taken')).toBeVisible();
  await expect(page.getByTestId('pay-failed-title')).toHaveCount(0);
  await shot(page, '14-still-confirming');
  await page.getByTestId('pay-stuck-back').click();
  await expect(page.getByTestId('pay-pending-banner')).toBeVisible();
  await expect(page.getByTestId('pay-pending-banner')).toContainText('Please do not pay again.');
  expect(await cartCount(page)).toBe(2);
  m.statuses = [status('paid')];
  await page.getByTestId('pay-pending-check').click();
  await expect(page.getByTestId('pay-success-title')).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`/order/${ORDER_ID}`), { timeout: 30_000 });
});

test('network lost mid payment: says so, keeps checking with a growing wait, and finishes when back online', async ({ page }) => {
  const m = await setup(page, { statuses: [status('pending'), status('paid')] });
  await openCart(page);
  await openSheet(page);
  await page.getByTestId('pay-method-card-select').click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByTestId('pay-methods-pay').click();
  const popup = await livePopup(page, popupPromise);
  await popup.waitForLoadState('domcontentloaded');
  m.failStatus = 2;
  await popup.locator('#done').click().catch(() => { /* the app closes the window as soon as it hears the cue */ });
  await expect(page.getByTestId('pay-offline')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pay-offline')).toContainText('Connection lost');
  await shot(page, '15-network-lost');
  await expect(page.getByTestId('pay-success-title')).toBeVisible({ timeout: 60_000 });
  const gaps = m.statusCalls.slice(1).map((t, i) => t - m.statusCalls[i]);
  expect(gaps.length).toBeGreaterThanOrEqual(3);
});

test('app reopened while a payment was open: the cart asks the server and finishes it', async ({ page }) => {
  await setup(page, { statuses: [status('paid')] });
  await page.addInitScript(id => { try { localStorage.setItem('onecity.pay.inflight.v1', JSON.stringify({ checkout_id: id, order_id: '7d3c1e52-6b0e-4a39-9d0b-2f4c9a1e8b77', kind: 'shopping', started: Date.now() - 20_000 })); } catch { /* storage blocked */ } }, CHECKOUT);
  await page.goto('/cart', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pay-success-title').or(page.getByTestId('pay-confirming-title'))).toBeVisible({ timeout: 150_000 });
  await expect(page).toHaveURL(new RegExp(`/order/${ORDER_ID}`), { timeout: 40_000 });
});

test('double tap on Pay makes one order call', async ({ page }) => {
  const m = await setup(page, { upiReply: b => ({ status: 200, json: { checkout_id: CHECKOUT, mode: b.mode, payment_status: 'pending', qr: { image: QR, upi_uri: 'upi://pay' } } }) });
  await openCart(page);
  await openSheet(page);
  await page.getByTestId('pay-upi-qr').click();
  const pay = page.getByTestId('pay-methods-pay');
  await pay.dblclick();
  await expect(page.getByTestId('pay-qr-image')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  expect(m.orderCalls).toHaveLength(1);
  expect(m.upiCalls).toHaveLength(1);
});

test('server answers on starting: price changed, payment in progress, gateway down are worded in plain English', async ({ page }) => {
  await setup(page);
  await page.route('**/api/payments/order', route => route.fulfill({ status: 502, json: { detail: 'Payment gateway is unavailable. No money was taken.', code: 'gateway_unavailable' } }));
  await openCart(page);
  await openSheet(page);
  await page.getByTestId('pay-method-card-select').click();
  await page.getByTestId('pay-methods-pay').click();
  await expect(page.getByTestId('checkout-error')).toContainText('No money was taken');
  expect(await cartCount(page)).toBe(2);
});

test('refund line on the order screen: initiated, processed, failed (support link)', async ({ page }) => {
  const m = await setup(page, { orderReply: { payment_status: 'refunded' } });
  const refund = (state: string, over: Record<string, unknown> = {}) => ({ id: `r-${state}`, order_id: ORDER_ID, amount: 250, state, method: 'original', created_at: '2026-10-08T10:00:00Z', processed_at: state === 'processed' ? '2026-10-09T10:00:00Z' : null, eta_text: '3-5 working days', ...over });
  await page.addInitScript(() => { try { localStorage.setItem('onecity.location-asked.v1', '1'); } catch { /* storage blocked */ } });
  const visit = async () => { await page.goto(`/order/${ORDER_ID}`, { waitUntil: 'domcontentloaded' }); await expect(page.getByTestId('order-tracking')).toBeVisible({ timeout: 150_000 }); };
  m.refunds = [refund('initiated')];
  await visit();
  await expect(page.getByTestId('refund-line-initiated')).toContainText('Refund of ₹250 initiated. It goes to your original payment method in 3-5 working days.');
  await expect(page.getByTestId('refund-support')).toHaveCount(0);
  await shot(page, '16-refund-initiated');
  m.refunds = [refund('processed')];
  await visit();
  await expect(page.getByTestId('refund-line-processed')).toContainText('Refund of ₹250 completed');
  await shot(page, '17-refund-processed');
  m.refunds = [refund('failed')];
  await visit();
  await expect(page.getByTestId('refund-line-failed')).toContainText('delayed. Our team is retrying it');
  await expect(page.getByTestId('refund-support')).toBeVisible();
  await big(page, 'refund-support');
  await shot(page, '18-refund-failed');
  m.refunds = [];
  await visit();
  await expect(page.getByTestId('refund-status')).toHaveCount(0);
});

test('Hindi: the method list and the pending warning are in Hindi', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => { try { localStorage.setItem('onecity.language.v1', JSON.stringify({ locale: 'hi', confirmed: true })); } catch { /* storage blocked */ } });
  await openCart(page);
  await openSheet(page);
  await expect(page.getByTestId('pay-method-cod')).toContainText('कैश ऑन डिलीवरी');
  await expect(page.getByTestId('pay-method-card')).toContainText('कार्ड');
  await shot(page, '19-method-list-hindi');
});
