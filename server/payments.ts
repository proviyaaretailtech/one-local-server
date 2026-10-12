// Online payments through Razorpay (Orders API + Razorpay Checkout). Plain-English guide: docs/PAYMENTS.md.
// Cashfree is the active provider whenever CASHFREE_PG_APP_ID + CASHFREE_PG_SECRET_KEY are set (payment-provider.ts activeProvider); its checkout,
// status, UPI, hosted page, webhook and sweep live in cashfree-checkout.ts and this file hands over to it. Everything below that says
// Razorpay is unchanged and still serves checkouts that were started with Razorpay (ol_checkouts.payment_provider).
//
//   1. POST /api/payments/order   saves the checkout as payment 'pending' (createCheckout prices it and
//                                 splits it into one order per store) and opens ONE Razorpay order for
//                                 the SERVER's checkout total — never the app's number.
//   2. The app opens Razorpay Checkout. Card numbers, UPI PINs and bank logins are typed into
//      Razorpay's own page; nothing of that passes through the app or this server.
//   3. POST /api/payments/verify  checks Razorpay's signature and marks the checkout paid — every
//                                 store order in it together.
//   4. POST /api/payments/webhook Razorpay tells us directly. This is the source of truth: if the app
//                                 was closed mid-payment, the checkout still ends up paid (or failed).
// Every step is safe to repeat: payment state only ever moves forward (store.ts updatePayment).
// Every route takes the checkout id, or (older app versions) the id of any order in the checkout.
// With no Razorpay keys, online_payments is off, every route here answers 503 and checkout stays
// cash on delivery exactly as before.
import { caller } from './auth';
import { db, dbConfigured } from './db';
import { clientIp, HttpError, limit, readBody, readText, signatureOk } from './http';
import { adoptOrders, dispatchOrders } from './dispatch';
import { limitCaller } from './limits';
import { closeCashfreeOrder, reconcileCashfreeCheckout, startCashfreePayment } from './cashfree-checkout';
import { activeProvider, codRule } from './payment-provider';
import { razorpay, razorpayKeys as keys, requireKeys } from './razorpay';
import { refundLateCapture } from './refunds';
import { createCheckout, findPayment, ONLINE_METHODS, PaymentMethod, PaymentRecord, recordGatewayRefund, updatePayment } from './store';

const paise = (rupees: number) => Math.round(rupees * 100);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ---------- Signatures ----------
// Razorpay signs with HMAC-SHA256 and sends the result as hex; the check lives in http.ts.
export { signatureOk };

// ---------- What Razorpay Checkout opens on ----------
// The row the customer tapped (UPI app, card, net banking…) goes first as its own block; Razorpay's
// other methods stay below it, so a customer is never stuck if their pick fails. EMI and Pay Later
// only show when Razorpay has them switched on for the account.
export const UPI_APPS = ['google_pay', 'phonepe', 'paytm', 'bhim', 'whatsapp', 'id'] as const;
export type UpiApp = (typeof UPI_APPS)[number];
const BLOCK_NAMES: Record<string, string> = { upi: 'Pay by UPI', card: 'Credit & debit cards', netbanking: 'Netbanking', wallet: 'Wallets', paylater: 'Pay Later & EMI' };

function displayConfig(method: string, app: string) {
  const instruments = method === 'upi'
    ? [app === 'id' ? { method: 'upi', flows: ['collect'] } : (UPI_APPS as readonly string[]).includes(app) ? { method: 'upi', flows: ['intent', 'qr'], apps: [app] } : { method: 'upi' }]
    : method === 'paylater' ? [{ method: 'paylater' }, { method: 'cardless_emi' }, { method: 'emi' }]
    : [{ method }];
  return { display: { blocks: { chosen: { name: BLOCK_NAMES[method] ?? 'Pay', instruments } }, sequence: ['block.chosen'], preferences: { show_default_blocks: true } } };
}

// Everything Razorpay Checkout needs except the prefill (which stays in the app) and the callbacks.
function checkoutOptions(record: PaymentRecord, keyId: string, method: string, app: string) {
  const stores = record.order_ids.length;
  return {
    key: keyId, order_id: record.razorpay_order_id, amount: paise(record.total), currency: 'INR',
    name: 'One Local', description: `Order #${record.id.slice(0, 8).toUpperCase()}${stores > 1 ? ` · ${stores} stores` : ''}`,
    notes: { checkout_id: record.id }, theme: { color: '#174D37' },
    config: (ONLINE_METHODS as readonly string[]).includes(method) ? displayConfig(method, app) : undefined,
  };
}

// The caller's own checkout, found by its id or by any of its orders' ids.
async function ownedCheckout(request: Request, id: unknown): Promise<PaymentRecord> {
  const [{ matches }, record] = await Promise.all([caller(request), findPayment('id', text(id, 64))]);
  if (!record || !matches.includes(record.customer)) throw new HttpError(404, 'Order not found');
  return record;
}
// What the payment routes answer: the checkout, its store orders, and the first order for older app
// versions that only know one order.
const reply = (record: PaymentRecord, payment_status: string) => ({ order_id: record.order_ids[0] ?? record.id, checkout_id: record.id, order_ids: record.order_ids, payment_status });

// ---------- 1. Start a payment ----------
type StartBody = { payment_method?: unknown; upi_app?: unknown; prefill?: { name?: unknown; email?: unknown; contact?: unknown } };

export async function startPayment(request: Request, city: string): Promise<Record<string, any>> {
  if (activeProvider()?.name === 'cashfree') return startCashfreePayment(request, city);
  const k = requireKeys();
  await limitCaller(request, 'pay-start', 10, 60_000, { anonIpMax: 20 });
  const body = await readBody<StartBody>(request.clone());
  // Prices, coupon, the app's total check, idempotency, the split per store and payment 'pending' all
  // happen in createCheckout.
  const checkout = await createCheckout(request, city, true);
  let record = await findPayment('id', checkout.id);
  if (!record) throw new HttpError(500, 'Something went wrong. Please try again.');
  if (record.payment_method === 'cod') throw new HttpError(409, 'This order is already set to pay on delivery.');

  // One Razorpay order for the whole checkout, however many stores it spans. A retry of the same
  // checkout (same Idempotency-Key) reuses it: Razorpay allows several attempts on one order and
  // captures at most one, so the customer is never charged twice.
  if (!record.razorpay_order_id && record.payment_status !== 'paid') {
    const created = await razorpay<{ id: string; amount: number }>('/orders', {
      amount: paise(record.total), currency: 'INR', receipt: record.id, notes: { checkout_id: record.id },
    });
    if (created.amount !== paise(record.total)) throw new HttpError(502, 'Could not reach the payment service. No money was taken. Please try again.');
    await updatePayment(record.id, { razorpay_order_id: created.id, payment_provider: 'razorpay' }, ['pending', 'failed']);
    record = { ...record, razorpay_order_id: created.id };
  }

  const p = body.prefill ?? {};
  const email = text(p.email, 120), contact = text(p.contact, 15).replace(/\D/g, '');
  const prefill = { name: text(p.name, 80), email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '', contact: /^[6-9]\d{9}$/.test(contact) ? `+91${contact}` : '' };
  const method = text(body.payment_method, 20), app = text(body.upi_app, 20);
  return {
    provider: 'razorpay' as const, ...reply(record, record.payment_status),
    razorpay_order_id: record.razorpay_order_id, key_id: k.id, amount: paise(record.total), currency: 'INR', prefill,
    checkout: checkoutOptions(record, k.id, method, app),
  };
}

// ---------- 2. The app reports a successful payment ----------
// Only a checkout still waiting for its online payment can become paid. 'not_charged' is NOT here: that is a checkout the customer
// switched to pay on delivery, and a payment that shows up for it later is refunded, never turned into a paid order (SRV-3).
const PAYABLE = ['pending', 'failed'] as const;

// Razorpay's own record of the payment: the method actually used and the amount actually taken.
// Best effort — if Razorpay cannot be reached the signature alone is proof enough (Razorpay's guidance),
// and the webhook will fill in the method.
async function fetchPayment(paymentId: string) {
  try { return await razorpay<{ amount: number; method: string; order_id: string; status: string }>(`/payments/${encodeURIComponent(paymentId)}`); }
  catch { return null; }
}

const KNOWN_METHODS: PaymentMethod[] = ['upi', 'card', 'netbanking', 'wallet', 'paylater', 'emi', 'cardless_emi'];
const asMethod = (m: unknown) => (KNOWN_METHODS.includes(m as PaymentMethod) ? (m as PaymentMethod) : undefined);

// What happened to the money: it paid the checkout, or it arrived after the customer chose cash and was sent back.
type Paid = 'paid' | 'refunded_late';

async function markPaid(record: PaymentRecord, paymentId: string, method: PaymentMethod | undefined): Promise<Paid> {
  let current = record;
  if (record.payment_method !== 'cod') {
    const changed = await updatePayment(record.id, {
      payment_status: 'paid', razorpay_payment_id: paymentId, paid_at: new Date().toISOString(), payment_error: null, ...(method ? { payment_method: method } : {}),
    }, [...PAYABLE]);
    // The orders are now successful: take them to their restaurants and ping the rider pool (idempotent, so the app's verify and
    // Razorpay's webhook both landing is safe). An order no restaurant can take is cancelled and refunded inside adoptOrders.
    if (changed) { await dispatchOrders(await adoptOrders(record.order_ids)); return 'paid'; }
    // Not changed: someone else moved it first. If that was the customer switching to cash, this money must go back.
    current = (await findPayment('id', record.id)) ?? record;
  }
  if (current.payment_method === 'cod' && current.payment_status !== 'paid') {
    // The cash order is already with a rider as a cash job (collect the full total). Keeping this payment too would charge twice.
    if (dbConfigured()) await refundLateCapture(current.id, paymentId);
    else console.error('[payments] a payment arrived for a checkout switched to cash; refund it from the Razorpay dashboard', current.id, paymentId);
    return 'refunded_late';
  }
  // Paid twice for one checkout (two tabs, two phones): keep the first, flag the second for a refund.
  if (current.razorpay_payment_id && current.razorpay_payment_id !== paymentId) {
    console.error('[payments] second payment on an already-paid checkout — refund it from the Razorpay dashboard', current.id, paymentId);
  }
  return 'paid';
}

export async function verifyPayment(request: Request) {
  await limitCaller(request, 'pay-verify', 20, 60_000);
  const b = await readBody<Record<string, unknown>>(request);
  const record = await ownedCheckout(request, b.checkout_id ?? b.order_id);
  // Cashfree has no client-side signature to check: the answer is Cashfree's own record of the order, re-read now (same as GET /payments/status).
  if (record.payment_provider === 'cashfree') { const fresh = await reconcileCashfreeCheckout(record, 'verify'); return reply(fresh, fresh.payment_status); }
  const k = requireKeys();
  const rzpOrder = text(b.razorpay_order_id, 64), paymentId = text(b.razorpay_payment_id, 64);

  if (record.payment_status === 'paid' && record.razorpay_payment_id === paymentId) return reply(record, 'paid');
  if (!rzpOrder || rzpOrder !== record.razorpay_order_id || !(await signatureOk(k.secret, `${rzpOrder}|${paymentId}`, b.razorpay_signature))) {
    throw new HttpError(400, 'We could not confirm this payment. If money was taken it will be matched to your order shortly, or refunded.');
  }
  const payment = await fetchPayment(paymentId);
  if (payment && (payment.amount !== paise(record.total) || payment.order_id !== rzpOrder)) {
    console.error('[payments] amount mismatch on verify', record.id, payment.amount, paise(record.total));
    await updatePayment(record.id, { payment_error: 'Paid amount did not match the order' }, ['pending', 'failed']);
    throw new HttpError(409, 'The amount paid did not match your order. Our team will refund it. Please contact support.');
  }
  if ((await markPaid(record, paymentId, asMethod(payment?.method))) === 'refunded_late') {
    throw new HttpError(409, 'You chose to pay on delivery for this order, so this online payment is being refunded to you. Please keep cash ready for the rider.', undefined, 'switched_to_cash');
  }
  return reply(record, 'paid');
}

// ---------- Switch a failed or abandoned online payment to cash ----------
// The same checkout (all its store orders) becomes cash on delivery rather than a second one being
// placed, so a payment that was only slow (and lands later through the webhook) can never leave the
// customer with two orders.
export async function switchToCash(request: Request) {
  await limitCaller(request, 'pay-cash', 10, 60_000);
  const b = await readBody<Record<string, unknown>>(request);
  const record = await ownedCheckout(request, b.checkout_id ?? b.order_id);
  if (record.payment_status === 'paid') return reply(record, 'paid');
  const rule = codRule(record.total);
  if (!rule.available) throw new HttpError(409, rule.reason === 'over_limit' ? 'Pay on delivery is not available for an order this size. Please pay online.' : 'Pay on delivery is not available right now.', undefined, 'cod_unavailable');
  const switched = await updatePayment(record.id, { payment_method: 'cod', payment_status: 'not_charged', payment_error: null }, ['pending', 'failed']);
  if (switched) await closeCashfreeOrder(record); // nobody can pay the old Cashfree order any more; a payment already in flight is refunded when it lands
  // A cash order is successful the moment it is placed, so it goes to the rider pool now. From here the checkout is a cash
  // checkout for good: a payment that lands on its old Razorpay order later is refunded (markPaid), not turned into a paid order.
  if (switched) { await dispatchOrders(await adoptOrders(record.order_ids)); }
  const now = await findPayment('id', record.id);
  return reply(record, now?.payment_status ?? 'not_charged');
}

// ---------- 3. Razorpay tells us directly ----------
// Event ids already handled. Handling is idempotent anyway; this just skips the work and keeps an
// audit trail (ol_payment_events, migration 0025) — ids and outcome only, never the payload.
const g = globalThis as unknown as { __onecityPayEvents?: Set<string> };
const seenInMemory = (g.__onecityPayEvents ??= new Set());

async function alreadyHandled(eventId: string) {
  if (!eventId) return false;
  if (!dbConfigured()) return seenInMemory.has(eventId);
  const { data } = await db().from('ol_payment_events').select('event_id').eq('event_id', eventId).maybeSingle();
  return !!data;
}

// The checkout the event was about (checkout_id, migration 0026) and its first order.
async function remember(eventId: string, event: string, record: PaymentRecord | null, paymentId: string | null) {
  if (!eventId) return;
  if (!dbConfigured()) { if (seenInMemory.size > 10_000) seenInMemory.clear(); seenInMemory.add(eventId); return; }
  const { error } = await db().from('ol_payment_events').insert({ event_id: eventId, event, checkout_id: record?.id ?? null, order_id: record?.order_ids[0] ?? null, razorpay_payment_id: paymentId });
  if (error && error.code !== '23505') console.error('[payments] could not record webhook event', event, error.message);
}

type PaymentEntity = { id: string; order_id: string; amount: number; method?: string; notes?: Record<string, string>; error_description?: string };

export async function handleWebhook(request: Request) {
  const secret = keys().webhook;
  if (!secret) throw new HttpError(503, 'Payment webhook is not set up');
  // Anyone can post here, so the signature decides before a genuine delivery is counted: unsigned or wrongly signed requests are
  // limited per address, and only a valid one uses the shared budget, so a flood can no longer make Razorpay's real deliveries
  // answer 429 (SRV-9 P3-1).
  const raw = await readText(request, 256 * 1024);
  // The signature covers the exact bytes Razorpay sent, so it is checked before anything is parsed.
  if (!(await signatureOk(secret, raw, request.headers.get('x-razorpay-signature')))) {
    limit(clientIp(request), 'pay-webhook-bad', 20, 60_000);
    throw new HttpError(400, 'Invalid signature');
  }
  limit('razorpay', 'pay-webhook', 600, 60_000);

  let body: { event?: string; payload?: { payment?: { entity?: PaymentEntity }; order?: { entity?: { id: string } }; refund?: { entity?: { id: string; payment_id: string; amount: number } } } };
  try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid body'); }
  const event = text(body.event, 60);
  const eventId = text(request.headers.get('x-razorpay-event-id'), 100);
  if (await alreadyHandled(eventId)) return { ok: true };

  const payment = body.payload?.payment?.entity;
  const refund = body.payload?.refund?.entity;
  let about: PaymentRecord | null = null;

  if (event === 'payment.captured' || event === 'order.paid' || event === 'payment.failed') {
    const rzpOrder = payment?.order_id || body.payload?.order?.entity?.id || '';
    const record = (await findPayment('razorpay_order_id', rzpOrder)) ?? (await findPayment('id', text(payment?.notes?.checkout_id || payment?.notes?.order_id, 64)));
    if (!payment || !record) {
      console.error('[payments] webhook for an order we do not know', event, rzpOrder);
    } else if (event === 'payment.failed') {
      about = record;
      await updatePayment(record.id, { payment_status: 'failed', payment_error: text(payment.error_description, 200) || 'Payment failed' }, ['pending']);
    } else if (payment.amount !== paise(record.total)) {
      about = record;
      console.error('[payments] amount mismatch on webhook', record.id, payment.amount, paise(record.total));
      await updatePayment(record.id, { payment_error: 'Paid amount did not match the order' }, ['pending', 'failed']);
    } else {
      about = record;
      await markPaid(record, payment.id, asMethod(payment.method));
    }
  } else if (event === 'refund.processed' && refund) {
    const record = await findPayment('razorpay_payment_id', refund.payment_id);
    if (record) { about = record; await recordGatewayRefund(record.id, refund.id, refund.amount / 100); }
    else console.error('[payments] refund for a payment we do not know', refund.id);
  }

  await remember(eventId, event, about, payment?.id ?? refund?.payment_id ?? null);
  return { ok: true };
}

// ---------- Checkout page for the phone app ----------
// The native app shows Razorpay Checkout inside a WebView (react-native-webview is already in the iOS
// build; the Razorpay native SDK would need a new build — see docs/PAYMENTS.md). The page is loaded with
// the customer's own headers, so only the owner can open it; the amount and ids come from our record.
// Name/phone/email are handed in by the app after load, so they never appear in a URL.
export async function checkoutPage(request: Request) {
  const k = requireKeys();
  await limitCaller(request, 'pay-page', 20, 60_000);
  const url = new URL(request.url);
  // `order` is the checkout id or (older app versions) one of its orders' ids.
  const record = await ownedCheckout(request, url.searchParams.get('checkout') ?? url.searchParams.get('order'));
  if (!record.razorpay_order_id || record.payment_status === 'paid' || record.payment_method === 'cod') throw new HttpError(409, 'This order has nothing left to pay.');
  const options = checkoutOptions(record, k.id, text(url.searchParams.get('method'), 20), text(url.searchParams.get('app'), 20));
  const safe = JSON.stringify(options).replace(/</g, '\\u003c');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pay securely</title><style>body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#F8F9F5;color:#1A1A1A;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center}p{max-width:280px;line-height:1.5}</style></head>
<body><p id="m">Opening secure payment…</p>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
(function () {
  var options = ${safe}, failure = '';
  function send(m) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function open(withConfig) {
    var o = Object.assign({}, options, {
      prefill: (window.__OL_PREFILL || {}),
      handler: function (r) { send({ type: 'success', razorpay_payment_id: r.razorpay_payment_id, razorpay_order_id: r.razorpay_order_id, razorpay_signature: r.razorpay_signature }); },
      modal: { confirm_close: true, ondismiss: function () { send(failure ? { type: 'failed', reason: failure } : { type: 'dismiss' }); } }
    });
    if (!withConfig) delete o.config;
    var rzp = new Razorpay(o);
    rzp.on('payment.failed', function (r) { failure = (r && r.error && r.error.description) || 'Payment failed'; });
    rzp.open();
  }
  if (typeof Razorpay === 'undefined') { document.getElementById('m').textContent = 'Could not load the payment page. Check your internet and try again.'; send({ type: 'failed', reason: 'Could not load the payment page' }); return; }
  // If Razorpay rejects the method shortcut (for example an app it does not list), open the full page instead.
  try { open(true); } catch (e) { open(false); }
})();
</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } });
}
