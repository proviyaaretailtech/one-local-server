// Customer checkout through Cashfree: UPI, cards, netbanking, wallets. The app-facing contract is the top section of docs/PAYMENTS.md ("App API (Cashfree)").
//
//   POST /payments/order    saves the checkout as 'pending' (store.ts createCheckout prices it from the SERVER's bill) and opens ONE Cashfree order for
//                           its total. The reply carries payment_session_id (short-lived, never stored) and the address of OUR hosted page.
//   hosted page             loads Cashfree's own checkout JS with the session id. Card numbers, PINs and bank logins never touch this server.
//   POST /payments/upi      optional: UPI intent link / QR / collect without Cashfree's page ("order pay").
//   GET  /payments/status   the only thing the app believes. Re-reads Cashfree when the answer is still pending; state only moves forward.
//   POST /payments/webhook  Cashfree -> us, signed. The source of truth when the app was closed; logged once per event (payment_webhook_events).
//   sweepCashfreePayments   re-reads checkouts still pending after 2 minutes (a laptop cannot receive webhooks; a webhook can be lost).
// Payment state only ever moves forward (store.ts updatePayment): pending/failed -> paid, pending -> failed. A repeat of anything is a no-op.
import { caller } from './auth';
import { db, dbConfigured } from './db';
import { adoptOrders, dispatchOrders } from './dispatch';
import { clientIp, constantTimeEqual, hmacHex, HttpError, limit, readBody, readText, sha256 } from './http';
import { limitCaller } from './limits';
import { CashfreeError, cashfreeKeys, clientHints, gatewayDown, mapPayment, payWithUpi, terminateCfOrder, type UpiMode } from './cashfree';
import { activeProvider, cashfreeProvider, codRule, type ProviderOrderInfo, type ProviderPaymentInfo } from './payment-provider';
import { refundLateCapture } from './refunds';
import { createCheckout, findPayment, FailureCode, ONLINE_METHODS, PaymentRecord, recordGatewayRefund, updatePayment } from './store';

const paise = (rupees: number) => Math.round(rupees * 100);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const SESSION_MINUTES = 30;
const POLL = { every_ms: 3000, give_up_after_ms: 300_000 };
const UPI_APPS = ['google_pay', 'phonepe', 'paytm', 'bhim'] as const;

/** What a failed attempt tells the customer, in plain words. The raw gateway reason is never shown or stored. */
export const FAILURE_TEXT: Record<FailureCode, string> = {
  dropped: 'You closed the payment before it finished. No money was taken.',
  declined: 'Your bank or UPI app did not approve the payment. No money was taken.',
  expired: 'The payment time ran out. No money was taken.',
  unknown: 'The payment did not go through. No money was taken.',
};

// ---------- addresses and tokens ----------
/** Where Cashfree sends the customer back to and calls us: PUBLIC_API_URL, else BACKEND_URL (the app's own API address), else this request's origin. */
export function publicBase(request: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim() || process.env.PUBLIC_API_URL?.trim() || process.env.BACKEND_URL?.trim();
  return (configured || new URL(request.url).origin).replace(/\/+$/, '').replace(/\/api$/, '');
}
// A signed, expiring token for the hosted page and the return page, so a browser tab (web) that cannot send our identity headers can still open
// exactly one checkout. It proves nothing but "the owner started this checkout in the last 35 minutes"; the money still moves only on Cashfree's side.
async function pageToken(checkoutId: string, expiresAt: number): Promise<string> {
  const key = cashfreeKeys().secret || process.env.OTP_HMAC_SECRET || 'dev-only-page-token';
  return `${expiresAt.toString(36)}.${(await hmacHex(key, `ol-pay-page|${checkoutId}|${expiresAt}`)).slice(0, 32)}`;
}
async function tokenOk(checkoutId: string, token: string): Promise<boolean> {
  const expiresAt = parseInt(token.split('.')[0] ?? '', 36);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || expiresAt > Date.now() + 2 * 3600_000) return false;
  return constantTimeEqual(await pageToken(checkoutId, expiresAt), token);
}
/** The caller's own checkout, found by its id (or one of its orders' ids), by identity headers or by the page token. */
async function accessible(request: Request, id: unknown, token?: string | null): Promise<PaymentRecord> {
  const record = await findPayment('id', text(id, 64));
  if (!record) throw new HttpError(404, 'Order not found');
  if (token && (await tokenOk(record.id, token))) return record;
  const { matches } = await caller(request);
  if (!matches.includes(record.customer)) throw new HttpError(404, 'Order not found');
  return record;
}
const reply = (record: PaymentRecord, payment_status: string) => ({ order_id: record.order_ids[0] ?? record.id, checkout_id: record.id, order_ids: record.order_ids, payment_status });

// ---------- GET /payments/methods ----------
export async function paymentMethods(request: Request) {
  await limitCaller(request, 'pay-methods', 60, 60_000, { verify: false, anonIpMax: 120 });
  const provider = activeProvider();
  const total = Number(new URL(request.url).searchParams.get('total'));
  const on = !!provider, direct = provider?.name === 'cashfree';
  const hosted = { available: on, hosted: on };
  return {
    provider: provider?.name ?? 'none', online: on,
    environment: direct ? cashfreeKeys().env : provider ? (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_live_') ? 'production' : 'sandbox') : null,
    cod: codRule(Number.isFinite(total) && total > 0 ? total : null),
    // Collect (typing a UPI ID) is offered last: NPCI is switching it off on Android and desktop (Cashfree blocks it since 28 Feb 2026; iOS still works).
    upi: { available: on, hosted: on, apps: on ? [...UPI_APPS] : [], intent: direct, qr: direct, collect: direct, collect_note: 'May not work on Android phones' },
    card: hosted, netbanking: hosted, wallet: hosted, paylater: { available: false, hosted: false },
  };
}

// ---------- POST /payments/order ----------
type StartBody = { payment_method?: unknown; upi_app?: unknown; prefill?: { name?: unknown; email?: unknown; contact?: unknown } };

async function startReply(request: Request, record: PaymentRecord, order: ProviderOrderInfo | null, method: string, app: string) {
  const base = publicBase(request);
  const token = await pageToken(record.id, Date.now() + (SESSION_MINUTES + 5) * 60_000);
  const q = `checkout=${encodeURIComponent(record.id)}&t=${encodeURIComponent(token)}`;
  return {
    provider: 'cashfree' as const, environment: cashfreeKeys().env, ...reply(record, record.payment_status),
    amount: paise(record.total), amount_rupees: record.total, currency: 'INR' as const,
    ...(order ? {
      payment_session_id: order.sessionId, cf_order_id: order.providerRef, expires_at: order.expiresAt,
      checkout_url: `${base}/api/payments/checkout-page?${q}&method=${encodeURIComponent(method)}&app=${encodeURIComponent(app)}`,
      return_url: `${base}/api/payments/return?${q}`,
      poll: { status_path: `/payments/status?checkout_id=${record.id}`, ...POLL },
    } : {}),
  };
}

export async function startCashfreePayment(request: Request, city: string) {
  await limitCaller(request, 'pay-start', 10, 60_000, { anonIpMax: 20 });
  const body = await readBody<StartBody>(request.clone());
  const method = text(body.payment_method, 20), app = text(body.upi_app, 20);
  if (!(ONLINE_METHODS as readonly string[]).includes(method)) throw new HttpError(400, 'Choose how you want to pay.', undefined, 'choose_method');
  const p = body.prefill ?? {};
  const contact = text(p.contact, 20).replace(/\D/g, '').slice(-10);
  // Cashfree wants a mobile number on every order; ask for it before anything is saved.
  if (!/^[6-9]\d{9}$/.test(contact)) throw new HttpError(400, 'Add your mobile number to pay online.', undefined, 'phone_required');
  const email = text(p.email, 100);

  // Prices, coupon, the app's total check, idempotency, the split per store and payment 'pending' all happen in createCheckout.
  const checkout = await createCheckout(request, city, true);
  const record = await findPayment('id', checkout.id);
  if (!record) throw new HttpError(500, 'Something went wrong. Please try again.');
  if (record.payment_method === 'cod') throw new HttpError(409, 'This order is already set to pay on delivery.', undefined, 'switched_to_cash');
  if (record.payment_status === 'paid') return startReply(request, record, null, method, app);
  if (record.razorpay_order_id && record.payment_provider !== 'cashfree') throw new HttpError(409, 'This payment was started another way. Please go back to your cart and try again.', undefined, 'provider_changed');

  const { record: current, order } = await ensureAttempt(request, record, { method, contact, name: text(p.name, 80), email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '' });
  if (current.payment_status === 'paid') return startReply(request, current, null, method, app);
  return startReply(request, current, order, method, app);
}

// One live Cashfree order per checkout. A retry (same Idempotency-Key, same basket) reuses it while it is active; a new Cashfree order is only
// opened when the last one has expired or been closed (Cashfree never reuses an order id: <checkout id> first, then <checkout id>-2, -3 ...).
async function ensureAttempt(request: Request, record: PaymentRecord, who: { method: string; contact: string; name: string; email: string }): Promise<{ record: PaymentRecord; order: ProviderOrderInfo }> {
  if (record.provider_order_id) {
    let existing: ProviderOrderInfo | null = null;
    try { existing = await cashfreeProvider.fetchOrder(record.provider_order_id); }
    catch (error) { if (!(error instanceof CashfreeError && error.status === 404)) throw gatewayDown(); }
    if (existing?.status === 'paid') {
      const fresh = await reconcileCashfreeCheckout(record, 'start');
      if (fresh.payment_status === 'paid') return { record: fresh, order: existing };
    }
    if (existing?.status === 'active' && existing.sessionId) {
      // A payment that is still being confirmed with the bank: never open another, the customer must not pay twice.
      const attempts = await cashfreeProvider.fetchPayments(record.provider_order_id).catch(() => []);
      if (attempts.some(a => a.status === 'pending' && (!a.time || Date.now() - Date.parse(a.time) < 10 * 60_000))) {
        throw new HttpError(409, 'We are still confirming your earlier payment with your bank. Please wait a minute and check again. Do not pay twice.', undefined, 'payment_in_progress');
      }
      if (record.payment_method !== who.method) await updatePayment(record.id, { payment_method: who.method as PaymentRecord['payment_method'] }, ['pending', 'failed']);
      return { record: (await findPayment('id', record.id)) ?? record, order: existing };
    }
  }
  const n = record.payment_attempts + 1;
  const orderId = n === 1 ? record.id : `${record.id}-${n}`;
  const base = publicBase(request);
  const token = await pageToken(record.id, Date.now() + (SESSION_MINUTES + 5) * 60_000);
  let order: ProviderOrderInfo;
  try {
    order = await cashfreeProvider.createOrder({
      orderId, amountMinor: paise(record.total), customerId: `cust${record.customer.replace(/[^A-Za-z0-9]/g, '').slice(0, 32)}`, phone: who.contact,
      ...(who.name.length >= 3 ? { name: who.name } : {}), ...(who.email ? { email: who.email } : {}),
      returnUrl: `${base}/api/payments/return?checkout=${encodeURIComponent(record.id)}&t=${encodeURIComponent(token)}`,
      ...(base.startsWith('https://') ? { notifyUrl: `${base}/api/payments/webhook` } : {}),
      expiresAt: new Date(Date.now() + SESSION_MINUTES * 60_000), note: `Order #${record.id.slice(0, 8).toUpperCase()}`, tags: { checkout_id: record.id },
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // Why Cashfree said no is in the log (code and message, no payload); the customer is told nothing was taken.
    throw gatewayDown();
  }
  if (!order.sessionId) throw gatewayDown();
  const moved = await updatePayment(record.id, {
    payment_provider: 'cashfree', provider_order_id: orderId, cf_order_id: order.providerRef, payment_attempts: n,
    payment_method: who.method as PaymentRecord['payment_method'], payment_failure_code: null,
  }, ['pending', 'failed']);
  const fresh = (await findPayment('id', record.id)) ?? record;
  if (!moved && fresh.payment_status !== 'paid') throw new HttpError(409, 'This order can no longer be paid online.', undefined, 'switched_to_cash');
  return { record: fresh, order };
}

// ---------- reading Cashfree back: status poll, return page, sweep ----------
type Source = 'poll' | 'start' | 'verify' | 'return' | 'sweep' | 'webhook';

async function markFailed(record: PaymentRecord, code: FailureCode): Promise<void> {
  await updatePayment(record.id, { payment_status: 'failed', payment_failure_code: code, payment_error: FAILURE_TEXT[code] }, ['pending']);
}

/** The result of a payment that Cashfree says succeeded. */
export type Settled = 'paid' | 'amount_mismatch' | 'refunded_late' | 'duplicate_payment';

async function settleSuccess(record: PaymentRecord, payment: { id: string; amountMinor: number; method?: PaymentRecord['payment_method']; group: string | null; reference: string | null }, viaOrderId: string): Promise<Settled> {
  if (payment.amountMinor !== paise(record.total)) {
    console.error('[payments] amount mismatch on a Cashfree payment', record.id, payment.id, payment.amountMinor, paise(record.total));
    await updatePayment(record.id, { payment_status: 'failed', payment_failure_code: 'unknown', payment_error: 'The amount paid did not match your order. Our team will refund it. Please contact support.' }, ['pending']);
    return 'amount_mismatch';
  }
  if (record.payment_method !== 'cod') {
    const changed = await updatePayment(record.id, {
      payment_status: 'paid', cf_payment_id: payment.id, payment_group: payment.group, payment_reference_masked: payment.reference, paid_at: new Date().toISOString(),
      payment_error: null, payment_failure_code: null, payment_provider: 'cashfree', ...(payment.method ? { payment_method: payment.method } : {}),
    }, ['pending', 'failed']);
    // The orders are now successful: take them to their restaurants and ping the rider pool (idempotent: the webhook, the poll and the sweep may all land).
    if (changed) { await dispatchOrders(await adoptOrders(record.order_ids)); return 'paid'; }
  }
  const current = (await findPayment('id', record.id)) ?? record;
  if (current.payment_method === 'cod' && current.payment_status !== 'paid') {
    // The cash order is already with a rider as a cash job: this online money goes back in full.
    if (dbConfigured()) await refundLateCapture(current.id, payment.id, { providerOrderId: viaOrderId, paidMinor: payment.amountMinor });
    else console.error('[payments] a Cashfree payment arrived for a checkout switched to cash; refund it from the Cashfree dashboard', current.id, payment.id);
    return 'refunded_late';
  }
  if (current.cf_payment_id && current.cf_payment_id !== payment.id) {
    // Paid twice for one checkout (two tabs, two phones). Cashfree itself refunds a second payment on the SAME order; a payment on another
    // attempt's order is sent back here under its own refund id (olx_ ids are not ledgered against a store order, see docs/PAYMENTS.md).
    await refundDuplicate(current, viaOrderId, payment);
    return 'duplicate_payment';
  }
  return 'paid';
}

async function refundDuplicate(record: PaymentRecord, viaOrderId: string, payment: { id: string; amountMinor: number }) {
  try {
    const sameOrder = (await cashfreeProvider.fetchPayments(viaOrderId)).filter(p => p.status === 'success');
    if (sameOrder.length > 1) return; // two successes on one Cashfree order: Cashfree's own auto-refund returns the later one
    const refundId = `olx_${(await sha256(`ol-dup|${payment.id}`)).slice(0, 24)}`;
    await cashfreeProvider.createRefund({ providerOrderId: viaOrderId, paymentId: payment.id, amountMinor: payment.amountMinor, refundId, speed: 'STANDARD', note: 'Duplicate payment' });
  } catch (error) {
    console.error('[payments] a duplicate Cashfree payment could not be refunded; refund it from the Cashfree dashboard', record.id, payment.id, error instanceof HttpError ? error.detail : (error as Error)?.message);
  }
}

/**
 * Re-reads a Cashfree checkout from Cashfree and applies what it says, forward only. Safe to call at any time and as often as wanted: a poll
 * within 2 seconds of the last read is answered from the record. Returns the checkout as it stands afterwards.
 */
export async function reconcileCashfreeCheckout(record: PaymentRecord, source: Source = 'poll'): Promise<PaymentRecord> {
  if (record.payment_provider !== 'cashfree' || !record.provider_order_id) return record;
  if (!['pending', 'failed'].includes(record.payment_status) || record.payment_method === 'cod') return record;
  if (source === 'poll' && record.payment_checked_at && Date.now() - Date.parse(record.payment_checked_at) < 2000) return record;
  let order: ProviderOrderInfo, payments: ProviderPaymentInfo[];
  try { [order, payments] = await Promise.all([cashfreeProvider.fetchOrder(record.provider_order_id), cashfreeProvider.fetchPayments(record.provider_order_id)]); }
  catch { return record; } // Cashfree cannot be reached right now: the record stands, the next poll or sweep tries again
  await updatePayment(record.id, { payment_checked_at: new Date().toISOString() }, ['pending', 'failed']);
  const success = payments.find(p => p.status === 'success');
  if (success) await settleSuccess(record, success, record.provider_order_id);
  else if (!payments.some(p => p.status === 'pending')) {
    const last = [...payments].reverse().find(p => p.status === 'failed' || p.status === 'dropped');
    if (order.status === 'expired' || order.status === 'terminated') await markFailed(record, last?.status === 'dropped' ? 'dropped' : last ? 'declined' : 'expired');
    else if (last) await markFailed(record, last.status === 'dropped' ? 'dropped' : 'declined');
  }
  return (await findPayment('id', record.id)) ?? record;
}

// ---------- GET /payments/status ----------
export type Outcome = 'pending' | 'paid' | 'failed' | 'dropped' | 'expired' | 'refunded' | 'cod';
function outcomeOf(record: PaymentRecord): Outcome {
  switch (record.payment_status) {
    case 'paid': return 'paid';
    case 'refunded': return 'refunded';
    case 'not_charged': return 'cod';
    case 'failed': return record.payment_failure_code === 'dropped' ? 'dropped' : record.payment_failure_code === 'expired' ? 'expired' : 'failed';
    default: return 'pending';
  }
}
export function statusBody(record: PaymentRecord) {
  const outcome = outcomeOf(record);
  return {
    provider: record.payment_provider ?? (record.razorpay_order_id ? 'razorpay' : 'cashfree'), ...reply(record, record.payment_status), amount: paise(record.total),
    outcome, method: record.payment_method === 'cod' ? 'cod' : record.payment_method,
    message: outcome === 'failed' || outcome === 'dropped' || outcome === 'expired' ? record.payment_error ?? FAILURE_TEXT.unknown : null,
    retry_ok: outcome === 'failed' || outcome === 'dropped' || outcome === 'expired',
    poll_after_ms: outcome === 'pending' ? POLL.every_ms : null,
  };
}
export async function checkoutStatus(request: Request) {
  await limitCaller(request, 'pay-status', 60, 60_000);
  const url = new URL(request.url);
  let record = await accessible(request, url.searchParams.get('checkout_id') ?? url.searchParams.get('order_id'), url.searchParams.get('t'));
  record = await reconcileCashfreeCheckout(record, 'poll');
  return statusBody(record);
}

// ---------- POST /payments/upi ----------
const VPA = /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,30}$/;
const maskVpa = (vpa: string) => { const [name, host] = vpa.split('@'); return `${name.slice(0, 2)}***@${host}`; };

export async function startUpi(request: Request) {
  await limitCaller(request, 'pay-upi', 10, 60_000);
  const b = await readBody<Record<string, unknown>>(request);
  const mode = text(b.mode, 10) as UpiMode;
  if (!['intent', 'qr', 'collect'].includes(mode)) throw new HttpError(400, 'Choose how you want to pay with UPI.', undefined, 'bad_mode');
  const upiId = text(b.upi_id, 80);
  if (mode === 'collect' && !VPA.test(upiId)) throw new HttpError(400, 'That UPI ID does not look right. It should look like name@bank.', undefined, 'upi_id_invalid');
  const record = await accessible(request, b.checkout_id, null);
  if (record.payment_provider !== 'cashfree' || !record.provider_order_id || record.payment_method === 'cod') throw new HttpError(409, 'This order has nothing left to pay online.', undefined, 'not_payable');
  if (record.payment_status === 'paid') throw new HttpError(409, 'This order is already paid.', undefined, 'already_paid');
  let order: ProviderOrderInfo, attempts: ProviderPaymentInfo[];
  try { [order, attempts] = await Promise.all([cashfreeProvider.fetchOrder(record.provider_order_id), cashfreeProvider.fetchPayments(record.provider_order_id)]); }
  catch { throw gatewayDown(); }
  if (order.status !== 'active' || !order.sessionId) throw new HttpError(409, 'This payment has timed out. Please start it again.', undefined, 'session_expired');
  if (attempts.some(a => a.status === 'pending' && (!a.time || Date.now() - Date.parse(a.time) < 10 * 60_000))) {
    throw new HttpError(409, 'We are still confirming your earlier payment with your bank. Please wait a minute and check again. Do not pay twice.', undefined, 'payment_in_progress');
  }
  let attempt;
  try { attempt = await payWithUpi({ sessionId: order.sessionId, mode, upiId, hints: clientHints(request) }); }
  catch (error) {
    if (error instanceof CashfreeError && mode === 'collect' && /vpa|upi_id/i.test(`${error.code} ${error.message}`)) throw new HttpError(400, 'That UPI ID does not look right. It should look like name@bank.', undefined, 'upi_id_invalid');
    // Direct UPI needs Cashfree to switch it on for the account (and on Android collect is blocked): the app falls back to the hosted page.
    throw new HttpError(502, 'Could not start the UPI payment here. Please use the payment page instead.', undefined, 'upi_direct_unavailable');
  }
  await updatePayment(record.id, { payment_method: 'upi' }, ['pending', 'failed']);
  const expiresIn = mode === 'collect' ? Math.max(30, Math.min(300, attempt.collectExpiresAt ? Math.round((Date.parse(attempt.collectExpiresAt) - Date.now()) / 1000) : 300)) : null;
  return {
    checkout_id: record.id, mode, payment_status: 'pending', cf_payment_id: attempt.cfPaymentId,
    ...(mode === 'intent' ? { intent: { links: attempt.links, url: attempt.url } } : {}),
    ...(mode === 'qr' ? { qr: { image: attempt.qrImage, upi_uri: attempt.upiUri } } : {}),
    ...(mode === 'collect' ? { collect: { upi_id_masked: maskVpa(upiId), expires_at: attempt.collectExpiresAt ?? new Date(Date.now() + 300_000).toISOString(), expires_in_s: expiresIn } } : {}),
    poll: { status_path: `/payments/status?checkout_id=${record.id}`, ...POLL },
  };
}

// ---------- switching to cash ----------
/** The customer chose pay on delivery: close the unpaid Cashfree order so nobody can pay it any more (best effort; a payment that still lands is refunded). */
export async function closeCashfreeOrder(record: PaymentRecord): Promise<void> {
  if (record.payment_provider !== 'cashfree' || !record.provider_order_id) return;
  try { await terminateCfOrder(record.provider_order_id); } catch { /* already paid, expired or unreachable: markPaid's refund path covers a late payment */ }
}

// ---------- hosted page and return page ----------
const HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const jsLiteral = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const STYLE = 'body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#F8F9F5;color:#1A1A1A;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}main{max-width:320px;padding:24px;line-height:1.5}h1{font-size:20px;margin:0 0 8px}p{margin:8px 0}a.button{display:inline-block;margin-top:16px;padding:12px 20px;min-height:20px;border-radius:12px;background:#174D37;color:#fff;text-decoration:none;font-weight:600}.ok{color:#174D37}.bad{color:#9B2C2C}';
// What the page tells the app or the web page that opened it. Only a cue: the app asks GET /payments/status for the truth.
const BRIDGE = (message: unknown) => `<script>(function(){var m=${jsLiteral(message)};try{if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(m));}catch(e){}var w=Object.assign({source:'ol-payment'},m);try{if(window.parent&&window.parent!==window)window.parent.postMessage(w,'*');}catch(e){}try{if(window.opener)window.opener.postMessage(w,'*');}catch(e){}})();</script>`;

function resultPage(title: string, lines: string[], tone: 'ok' | 'bad' | '', message: unknown, link?: string): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main role="status"><h1 class="${tone}">${escapeHtml(title)}</h1>${lines.map(l => `<p>${escapeHtml(l)}</p>`).join('')}${link ? `<a class="button" href="${escapeHtml(link)}">Back to One Local</a>` : ''}</main>${BRIDGE(message)}</body></html>`;
  return new Response(body, { headers: HEADERS });
}

export async function checkoutPage(request: Request) {
  await limitCaller(request, 'pay-page', 20, 60_000);
  const url = new URL(request.url);
  const record = await accessible(request, url.searchParams.get('checkout') ?? url.searchParams.get('order'), url.searchParams.get('t'));
  if (record.payment_status === 'paid') return resultPage('Payment received', ['Your order is placed.'], 'ok', { type: 'done', checkout_id: record.id, hint: 'paid' }, `onecity://payment-result?checkout_id=${record.id}&status=paid`);
  // A checkout started with Razorpay before Cashfree was switched on is still paid on Razorpay's page.
  if (record.razorpay_order_id && record.payment_provider !== 'cashfree') return (await import('./payments')).checkoutPage(request);
  if (record.payment_method === 'cod' || record.payment_provider !== 'cashfree' || !record.provider_order_id) throw new HttpError(409, 'This order has nothing left to pay.');
  let order: ProviderOrderInfo;
  try { order = await cashfreeProvider.fetchOrder(record.provider_order_id); } catch { throw gatewayDown(); }
  if (order.status !== 'active' || !order.sessionId) {
    return resultPage('This payment has timed out', ['No money was taken. Please go back and try again.'], 'bad', { type: 'failed', checkout_id: record.id, hint: 'failed' }, `onecity://payment-result?checkout_id=${record.id}&status=failed`);
  }
  // The session id is not a secret (it only lets the holder pay this one order) and is never stored; it is read from Cashfree for each page load.
  const init = jsLiteral({ sessionId: order.sessionId, mode: cashfreeKeys().env === 'production' ? 'production' : 'sandbox', checkoutId: record.id });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pay securely</title><style>${STYLE}</style></head>
<body><main><p id="m" role="status">Opening secure payment...</p></main>
<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
<script>
(function () {
  var init = ${init};
  function send(m) { try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} var w = Object.assign({ source: 'ol-payment' }, m); try { if (window.parent && window.parent !== window) window.parent.postMessage(w, '*'); } catch (e) {} try { if (window.opener) window.opener.postMessage(w, '*'); } catch (e) {} }
  var el = document.getElementById('m');
  if (typeof Cashfree === 'undefined') { el.textContent = 'Could not load the payment page. Check your internet and try again.'; send({ type: 'failed', checkout_id: init.checkoutId, hint: 'failed' }); return; }
  try {
    var cashfree = Cashfree({ mode: init.mode });
    // Cashfree sends the browser to the return page when it finishes (paid, failed or closed); that page tells the app.
    cashfree.checkout({ paymentSessionId: init.sessionId, redirectTarget: '_self' }).then(function (r) {
      if (r && r.error) { el.textContent = 'The payment could not be completed. Close this page and try again.'; send({ type: 'failed', checkout_id: init.checkoutId, hint: 'failed' }); }
    });
  } catch (e) { el.textContent = 'Could not open the payment page. Close this page and try again.'; send({ type: 'failed', checkout_id: init.checkoutId, hint: 'failed' }); }
})();
</script></body></html>`;
  return new Response(html, { headers: HEADERS });
}

export async function returnPage(request: Request) {
  await limitCaller(request, 'pay-return', 30, 60_000);
  const url = new URL(request.url);
  let record = await accessible(request, url.searchParams.get('checkout') ?? url.searchParams.get('order'), url.searchParams.get('t'));
  record = await reconcileCashfreeCheckout(record, 'return');
  const outcome = outcomeOf(record);
  const link = (status: string) => `onecity://payment-result?checkout_id=${record.id}&status=${status}`;
  if (outcome === 'paid') return resultPage('Payment received', ['Your order is placed. You can follow it in the app.'], 'ok', { type: 'done', checkout_id: record.id, hint: 'paid' }, link('paid'));
  if (outcome === 'pending') return resultPage('We are confirming your payment', ['We are checking with your bank. Please do not pay again. Your order will appear in a minute.'], '', { type: 'done', checkout_id: record.id, hint: 'pending' }, link('pending'));
  return resultPage('Payment did not go through', [record.payment_error ?? FAILURE_TEXT.unknown, 'You can try another way to pay. Your cart is saved.'], 'bad', { type: 'failed', checkout_id: record.id, hint: 'failed' }, link('failed'));
}

// ---------- webhook ----------
const g = globalThis as unknown as { __onecityCfEvents?: Map<string, string> };
const seenInMemory = (g.__onecityCfEvents ??= new Map());
type WebhookResult = { outcome: 'processed' | 'duplicate' | 'ignored' | 'amount_mismatch' | 'unknown_order' | 'refunded_late' | 'duplicate_payment'; record?: PaymentRecord | null; detail?: string; providerOrderId?: string; paymentId?: string; amountMinor?: number; onlinePaymentId?: string; organizationId?: string };

/** The checkout a Cashfree order id belongs to: <checkout id>, or <checkout id>-<attempt> for a later attempt after the first order expired. */
async function checkoutOf(orderId: string): Promise<PaymentRecord | null> {
  return (await findPayment('provider_order_id', orderId)) ?? (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-\d+)?$/i.test(orderId) ? findPayment('id', orderId.slice(0, 36)) : null);
}

async function onPaymentEvent(type: string, data: Record<string, any>): Promise<WebhookResult> {
  const orderId = text(data.order?.order_id, 64);
  const payment = mapPayment((data.payment ?? {}) as Record<string, any>, data.error_details as Record<string, any> | undefined);
  // Guest-bill payments (pos-payments.ts) use order ids that start with olp-; everything else is a customer checkout.
  if (orderId.startsWith('olp-')) return (await import('./pos-payments')).handlePosPaymentEvent(type, orderId, payment);
  const record = await checkoutOf(orderId);
  const base = { providerOrderId: orderId, paymentId: payment.id, amountMinor: payment.amountMinor };
  if (!record) { console.error('[payments] Cashfree webhook for an order we do not know', type); return { outcome: 'unknown_order', ...base }; }
  if (type === 'PAYMENT_SUCCESS') {
    const settled = await settleSuccess(record, payment, orderId);
    return { outcome: settled === 'paid' ? 'processed' : settled, record, ...base };
  }
  if (type === 'PAYMENT_FAILED' || type === 'PAYMENT_USER_DROPPED') {
    await markFailed(record, type === 'PAYMENT_USER_DROPPED' || payment.status === 'dropped' ? 'dropped' : 'declined');
    return { outcome: 'processed', record, ...base };
  }
  return { outcome: 'ignored', record, ...base };
}

async function onRefundEvent(type: string, data: Record<string, any>): Promise<WebhookResult> {
  const r = (type === 'AUTO_REFUND_STATUS' ? data.auto_refund : data.refund) as Record<string, any> | undefined;
  if (!r) return { outcome: 'ignored', detail: 'no refund in the event' };
  const merchantRef = text(r.refund_id, 80), cfRef = r.cf_refund_id != null ? String(r.cf_refund_id) : '', status = String(r.refund_status ?? '').toUpperCase();
  const orderId = text(r.order_id, 64);
  if (type === 'AUTO_REFUND_STATUS') return { outcome: 'ignored', detail: `Cashfree auto-refund ${status}`.slice(0, 120), providerOrderId: orderId };
  // A refund of a guest-bill payment (pos-payments.ts, refund ids olpr_...), not a customer-checkout refund.
  if (merchantRef.startsWith('olpr_')) return (await import('./pos-payments')).handlePosRefundEvent(r);
  if (dbConfigured()) {
    let row: { id: string } | null = null;
    if (merchantRef) row = ((await db().from('ol_refunds').select('id').eq('provider', 'cashfree').eq('reference', merchantRef).maybeSingle()).data as { id: string } | null) ?? null;
    if (!row && cfRef) row = ((await db().from('ol_refunds').select('id').eq('provider', 'cashfree').eq('provider_refund_id', cfRef).maybeSingle()).data as { id: string } | null) ?? null;
    if (row) {
      const { error } = await db().rpc('ol_refund_provider_update', {
        p_refund: row.id, p_provider: 'cashfree', p_merchant_ref: merchantRef || null, p_provider_refund_id: cfRef || null,
        p_provider_status: status, p_source: 'webhook', p_detail: text(r.status_description, 200) || null,
      });
      if (error) throw new HttpError(500, 'Something went wrong. Please try again.');
      return { outcome: 'processed', providerOrderId: orderId, detail: `refund ${status}` };
    }
  }
  if (merchantRef.startsWith('olx_')) return { outcome: 'ignored', detail: `duplicate-payment refund ${status}`, providerOrderId: orderId };
  // A refund nobody here asked for (made in the Cashfree dashboard): it has already moved the money, so it goes into the ledger as processed.
  const record = await checkoutOf(orderId);
  if (record && status === 'SUCCESS') { await recordGatewayRefund(record.id, cfRef || merchantRef, Number(r.refund_amount)); return { outcome: 'processed', record, providerOrderId: orderId, detail: 'refund made in the Cashfree dashboard' }; }
  return { outcome: 'ignored', record, providerOrderId: orderId, detail: `refund ${status} not asked for here` };
}

async function logSeen(eventId: string): Promise<string | null> {
  if (!dbConfigured()) return seenInMemory.get(eventId) ?? null;
  const { data } = await db().from('payment_webhook_events').select('outcome').eq('provider', 'cashfree').eq('event_id', eventId).maybeSingle();
  return (data?.outcome as string | undefined) ?? null;
}
async function logClaim(eventId: string, type: string, eventTime: string | null) {
  if (!dbConfigured()) { if (seenInMemory.size > 10_000) seenInMemory.clear(); seenInMemory.set(eventId, 'received'); return; }
  const { error } = await db().from('payment_webhook_events').upsert({ provider: 'cashfree', event_id: eventId, event_type: type.slice(0, 80), event_time: eventTime, outcome: 'received' }, { onConflict: 'provider,event_id', ignoreDuplicates: true });
  if (error) console.error('[payments] could not log the Cashfree webhook event', type, error.message);
}
async function logFinish(eventId: string, outcome: string, result: Partial<WebhookResult>) {
  if (!dbConfigured()) { seenInMemory.set(eventId, outcome); return; }
  let organizationId = result.organizationId ?? null;
  if (!organizationId && result.record) {
    const { data } = await db().from('ol_orders').select('organization_id').eq('checkout_id', result.record.id).not('organization_id', 'is', null).limit(1);
    organizationId = ((data ?? [])[0]?.organization_id as string | undefined) ?? null;
  }
  const { error } = await db().from('payment_webhook_events').update({
    outcome, detail: result.detail?.slice(0, 300) ?? null, handled_at: new Date().toISOString(), organization_id: organizationId, checkout_id: result.record?.id ?? null,
    online_payment_id: result.onlinePaymentId ?? null, provider_order_id: result.providerOrderId ?? null, provider_payment_id: result.paymentId ?? null, amount_minor: result.amountMinor ?? null,
  }).eq('provider', 'cashfree').eq('event_id', eventId);
  if (error) console.error('[payments] could not close the Cashfree webhook log row', error.message);
}

export async function handleCashfreeWebhook(request: Request) {
  // The signature covers the exact bytes Cashfree sent, so it is checked before anything is parsed. Anyone can post here: unsigned or wrongly
  // signed requests are limited per address, and only a valid one uses the shared budget, so a flood cannot make real deliveries answer 429.
  const raw = await readText(request, 256 * 1024);
  let verdict: { eventId: string };
  try { verdict = await cashfreeProvider.verifyWebhook(raw, request.headers); }
  catch (error) { if (error instanceof HttpError && error.status === 400) limit(clientIp(request), 'pay-webhook-bad', 20, 60_000); throw error; }
  limit('cashfree', 'pay-webhook', 600, 60_000);

  let body: { type?: string; event_time?: string; data?: Record<string, any> };
  try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid body'); }
  const type = text(body.type, 60).replace(/_WEBHOOK$/, '');
  const prior = await logSeen(verdict.eventId);
  if (prior && prior !== 'received' && prior !== 'error') return { ok: true, duplicate: true }; // already handled: nothing to do, answer 200 so Cashfree stops retrying
  await logClaim(verdict.eventId, type, text(body.event_time, 40) || null);

  let result: WebhookResult;
  try {
    const data = (body.data ?? {}) as Record<string, any>;
    result = type === 'REFUND_STATUS' || type === 'AUTO_REFUND_STATUS' ? await onRefundEvent(type, data)
      : type.startsWith('PAYMENT_') && ['PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PAYMENT_USER_DROPPED'].includes(type) ? await onPaymentEvent(type, data)
      : { outcome: 'ignored', detail: `event ${type} is not used here` };
  } catch (error) {
    await logFinish(verdict.eventId, 'error', { detail: error instanceof HttpError ? error.detail : (error as Error)?.message });
    throw error; // a 5xx makes Cashfree deliver the event again; the retry finds the log row in state 'error' and handles it
  }
  await logFinish(verdict.eventId, result.outcome, result);
  return { ok: true };
}

// ---------- the sweep: pending checkouts older than 2 minutes ----------
export async function sweepCashfreePayments(limitRows = 40): Promise<{ checked: number; paid: number; failed: number }> {
  const out = { checked: 0, paid: 0, failed: 0 };
  if (!cashfreeProvider.configured() || !dbConfigured()) return out;
  const now = Date.now();
  const { data, error } = await db().from('ol_checkouts').select('id, payment_status, created_at').eq('payment_provider', 'cashfree').in('payment_status', ['pending', 'failed'])
    .neq('payment_method', 'cod').lt('created_at', new Date(now - 2 * 60_000).toISOString()).gt('created_at', new Date(now - 24 * 3600_000).toISOString()).order('created_at').limit(limitRows);
  if (error) { console.error('[payments] sweep could not list pending Cashfree checkouts', error.message); return out; }
  for (const row of data ?? []) {
    // A failed checkout is only worth re-reading while its Cashfree order could still be paid (the order lives 30 minutes).
    if (row.payment_status === 'failed' && now - Date.parse(row.created_at as string) > (SESSION_MINUTES + 10) * 60_000) continue;
    const record = await findPayment('id', row.id as string);
    if (!record) continue;
    out.checked++;
    const after = await reconcileCashfreeCheckout(record, 'sweep');
    if (after.payment_status === 'paid' && record.payment_status !== 'paid') out.paid++;
    else if (after.payment_status === 'failed' && record.payment_status === 'pending') out.failed++;
  }
  return out;
}

// ---------- GET /payments/refund-status ----------
const REFUND_STATE: Record<string, 'initiated' | 'processed' | 'failed' | null> = { requested: 'initiated', approved: 'initiated', gateway_pending: 'initiated', processed: 'processed', failed: 'failed', rejected: null };
export async function refundStatus(request: Request) {
  await limitCaller(request, 'pay-refund-status', 60, 60_000);
  const url = new URL(request.url);
  const record = await accessible(request, url.searchParams.get('checkout_id') ?? url.searchParams.get('order_id'), null);
  const rows: { id: string; order_id: string; amount: number; state: 'initiated' | 'processed' | 'failed'; method: string; created_at: string; processed_at: string | null; eta_text: string }[] = [];
  if (dbConfigured() && record.order_ids.length) {
    const { data } = await db().from('ol_refunds').select('id, order_id, amount, status, method, created_at, processed_at').in('order_id', record.order_ids).order('created_at');
    for (const r of data ?? []) {
      const state = REFUND_STATE[r.status as string];
      if (!state) continue;
      rows.push({ id: r.id as string, order_id: r.order_id as string, amount: Number(r.amount), state, method: r.method as string, created_at: r.created_at as string, processed_at: (r.processed_at as string | null) ?? null, eta_text: r.method === 'original' ? '3-5 working days' : 'As soon as support confirms' });
    }
  }
  return { checkout_id: record.id, refunded_total: Math.round(rows.filter(r => r.state === 'processed').reduce((n, r) => n + r.amount, 0) * 100) / 100, refunds: rows };
}
