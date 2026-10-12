// The one place that talks to Cashfree's API with the account keys (Orders, Order Pay, Payments, Refunds) and the one place that checks
// a Cashfree webhook signature. payments.ts (customer checkout), pos-payments.ts (guest bill) and refunds.ts all use it, so they do not
// import each other. Plain-English guide: docs/PAYMENTS.md. Endpoints and fields were checked against Cashfree's official docs on 2026-10-08:
//   POST /pg/orders                              create order           -> cf_order_id, order_status, payment_session_id, order_expiry_time
//   GET  /pg/orders/{order_id}                   get order
//   GET  /pg/orders/{order_id}/payments          get payments for an order
//   POST /pg/orders/sessions                     order pay (UPI intent link / QR / collect), no client secret, the session id is the credential
//   POST /pg/orders/{order_id}/refunds           create refund  (refund_id 3-40 chars, refund_speed STANDARD|INSTANT, refund_note 3-100)
//   GET  /pg/orders/{order_id}/refunds/{refund_id}
// Headers: x-client-id, x-client-secret, x-api-version, x-request-id, x-idempotency-key (a UUID). The secret never leaves this file's requests.
import { HttpError, sha256, signatureBase64Ok } from './http';
import type { PaymentMethod } from './store';

const HOST = { sandbox: 'https://sandbox.cashfree.com/pg', production: 'https://api.cashfree.com/pg' } as const;
/** The newest stable API version in Cashfree's docs when this was written (latest = 2026-01-01). CASHFREE_API_VERSION overrides it. */
export const DEFAULT_API_VERSION = '2026-01-01';

export function cashfreeKeys() {
  return {
    id: process.env.CASHFREE_PG_APP_ID?.trim() ?? '',
    secret: process.env.CASHFREE_PG_SECRET_KEY?.trim() ?? '',
    // Sandbox unless the environment says production in so many words: a missing value can never move real money.
    env: (process.env.CASHFREE_ENV?.trim().toLowerCase() === 'production' ? 'production' : 'sandbox') as 'sandbox' | 'production',
    version: process.env.CASHFREE_API_VERSION?.trim() || DEFAULT_API_VERSION,
  };
}
export const cashfreeConfigured = () => { const k = cashfreeKeys(); return !!(k.id && k.secret); };

/** A failed Cashfree call: what Cashfree said (its code/type/message are not secret), never the request. */
export class CashfreeError extends Error {
  constructor(public status: number, public code: string, public type: string, message: string, public route: string) { super(message); }
}
/** The error a customer sees for any Cashfree failure that is not theirs to fix. */
export const gatewayDown = () => new HttpError(502, 'Could not reach the payment service. No money was taken. Please try again.', undefined, 'gateway_unavailable');

const short = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const routeOf = (path: string) => path.split('?')[0].replace(/\/orders\/[^/]+/, '/orders/:id').replace(/\/refunds\/[^/]+/, '/refunds/:id');

/** A stable UUID for one logical request (Cashfree wants a UUID as x-idempotency-key): the same label always gives the same key. */
export async function idempotencyUuid(label: string): Promise<string> {
  const h = await sha256(`ol-cashfree|${label}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

type CallOptions = { body?: unknown; idempotency?: string; headers?: Record<string, string>; auth?: boolean };

async function cf<T>(method: 'GET' | 'POST' | 'PATCH', path: string, opts: CallOptions = {}): Promise<T> {
  const k = cashfreeKeys();
  if (!k.id || !k.secret) throw new HttpError(503, 'Online payment is not available right now. Please choose Pay on delivery.', undefined, 'online_payments_off');
  const headers: Record<string, string> = {
    'x-api-version': k.version, 'content-type': 'application/json', 'x-request-id': crypto.randomUUID(),
    ...(opts.auth === false ? {} : { 'x-client-id': k.id, 'x-client-secret': k.secret }),
    ...(opts.idempotency ? { 'x-idempotency-key': opts.idempotency } : {}),
    ...opts.headers,
  };
  let r: Response;
  try {
    r = await fetch(`${HOST[k.env]}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: AbortSignal.timeout(12_000) });
  } catch (error) {
    console.error('[payments] cashfree', method, routeOf(path), 'no answer:', (error as Error)?.name);
    throw new CashfreeError(0, 'network', 'network_error', 'No answer from Cashfree', routeOf(path));
  }
  const json = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!r.ok) {
    // Only Cashfree's error code, type and short message are logged, never a payload.
    const error = new CashfreeError(r.status, short(json?.code, 80), short(json?.type, 80), short(json?.message, 200), routeOf(path));
    console.error('[payments] cashfree', method, error.route, r.status, error.code, error.type, error.message);
    throw error;
  }
  return json as T;
}

// ---------------------------------------------------------------- orders
export type CfOrderStatus = 'ACTIVE' | 'PAID' | 'EXPIRED' | 'TERMINATED' | 'TERMINATION_REQUESTED';
export type CfOrder = { orderId: string; cfOrderId: string; status: CfOrderStatus | string; sessionId: string | null; expiresAt: string | null; amountMinor: number };
const paise = (rupees: unknown) => Math.round(Number(rupees) * 100);
const mapOrder = (j: Record<string, any>): CfOrder => ({
  orderId: String(j.order_id ?? ''), cfOrderId: String(j.cf_order_id ?? ''), status: String(j.order_status ?? ''),
  sessionId: typeof j.payment_session_id === 'string' && j.payment_session_id ? j.payment_session_id : null,
  expiresAt: typeof j.order_expiry_time === 'string' ? j.order_expiry_time : null, amountMinor: paise(j.order_amount),
});

export type CreateCfOrder = {
  orderId: string; amountMinor: number; customerId: string; phone: string; name?: string; email?: string;
  returnUrl: string; notifyUrl?: string; expiresAt: Date; note: string; tags?: Record<string, string>;
};
export async function createCfOrder(a: CreateCfOrder): Promise<CfOrder> {
  const body = {
    order_id: a.orderId, order_amount: a.amountMinor / 100, order_currency: 'INR',
    customer_details: { customer_id: a.customerId, customer_phone: a.phone, ...(a.name ? { customer_name: a.name } : {}), ...(a.email ? { customer_email: a.email } : {}) },
    order_meta: { return_url: a.returnUrl, ...(a.notifyUrl ? { notify_url: a.notifyUrl } : {}) },
    order_expiry_time: a.expiresAt.toISOString(), order_note: a.note.slice(0, 200), ...(a.tags ? { order_tags: a.tags } : {}),
  };
  try {
    const order = mapOrder(await cf('POST', '/orders', { body, idempotency: await idempotencyUuid(`order:${a.orderId}`) }));
    if (order.amountMinor !== a.amountMinor) throw new CashfreeError(0, 'amount_mismatch', 'internal', 'Cashfree opened the order for a different amount', '/orders');
    return order;
  } catch (error) {
    // The same order id again (a retry after a lost reply, or a second server): read the order that exists instead of failing.
    if (error instanceof CashfreeError && error.status === 409) return fetchCfOrder(a.orderId);
    throw error;
  }
}
export const fetchCfOrder = async (orderId: string): Promise<CfOrder> => mapOrder(await cf('GET', `/orders/${encodeURIComponent(orderId)}`));
/** Closes an unpaid order so nobody can pay it any more (used when the customer switches to cash). Cashfree refuses if a payment already succeeded. */
export const terminateCfOrder = async (orderId: string): Promise<CfOrder> => mapOrder(await cf('PATCH', `/orders/${encodeURIComponent(orderId)}`, { body: { order_status: 'TERMINATED' } }));

// ---------------------------------------------------------------- payments
export type CfPaymentStatus = 'success' | 'failed' | 'dropped' | 'pending';
export type CfPayment = {
  id: string; status: CfPaymentStatus; rawStatus: string; amountMinor: number; group: string | null; method: PaymentMethod | undefined;
  reference: string | null; message: string | null; time: string | null; errorDescription: string | null;
};
const STATUS: Record<string, CfPaymentStatus> = { SUCCESS: 'success', FAILED: 'failed', USER_DROPPED: 'dropped', CANCELLED: 'failed', VOID: 'failed', PENDING: 'pending', NOT_ATTEMPTED: 'pending' };

/** Our method for a Cashfree payment_group. Unknown groups give undefined: the checkout then keeps the method the customer picked. */
export function methodOfGroup(group: unknown): PaymentMethod | undefined {
  switch (typeof group === 'string' ? group.toLowerCase() : '') {
    case 'upi': case 'upi_credit_card': case 'upi_ppi': case 'upi_ppi_offline': return 'upi';
    case 'credit_card': case 'debit_card': case 'prepaid_card': return 'card';
    case 'net_banking': return 'netbanking';
    case 'wallet': return 'wallet';
    case 'pay_later': return 'paylater';
    case 'cardless_emi': return 'cardless_emi';
    case 'credit_card_emi': case 'debit_card_emi': return 'emi';
    default: return undefined;
  }
}

/** A payer reference safe to keep for support: te***@okbank, ****4738, a bank or wallet name. Never a full UPI id or card number. */
export function maskedReference(method: unknown): string | null {
  const m = method && typeof method === 'object' ? method as Record<string, any> : {};
  const upi = m.upi?.upi_id;
  if (typeof upi === 'string' && upi.includes('@')) { const [name, host] = upi.split('@'); return `${name.slice(0, 2)}***@${host}`.slice(0, 60); }
  const card = m.card?.card_number;
  if (typeof card === 'string' && card.length >= 4) return `****${card.replace(/\D/g, '').slice(-4)}`;
  const bank = m.netbanking?.netbanking_bank_name ?? m.app?.provider ?? m.wallet?.provider;
  return typeof bank === 'string' && bank ? bank.slice(0, 60) : null;
}

/** One payment as Cashfree reports it, from "get payments" or from a webhook's data.payment. */
export function mapPayment(p: Record<string, any>, errorDetails?: Record<string, any> | null): CfPayment {
  const raw = String(p.payment_status ?? '').toUpperCase();
  const err = errorDetails ?? (p.error_details as Record<string, any> | null) ?? null;
  return {
    id: String(p.cf_payment_id ?? ''), status: STATUS[raw] ?? 'pending', rawStatus: raw, amountMinor: paise(p.payment_amount),
    group: typeof p.payment_group === 'string' ? p.payment_group : null, method: methodOfGroup(p.payment_group),
    reference: maskedReference(p.payment_method), message: short(p.payment_message, 200) || null,
    time: short(p.payment_completion_time || p.payment_time, 40) || null,
    errorDescription: short(err?.error_description || err?.error_description_raw, 200) || null,
  };
}
export async function fetchCfPayments(orderId: string): Promise<CfPayment[]> {
  const list = await cf<unknown>('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
  return (Array.isArray(list) ? list : []).map(p => mapPayment(p as Record<string, any>));
}

// ---------------------------------------------------------------- order pay: UPI intent link / QR / collect without Cashfree's page
export type ClientHints = Record<string, string>;
/** Cashfree wants to know the payer's device for UPI. Worked out from the user agent; the phone app's own http client counts as native. */
export function clientHints(request: Request): ClientHints {
  const ua = request.headers.get('user-agent') ?? '';
  const android = /Android|okhttp/i.test(ua), ios = /iPhone|iPad|iOS|CFNetwork|Darwin/i.test(ua);
  const native = /okhttp|CFNetwork|Expo/i.test(ua);
  const mobile = android || ios;
  const os = android ? 'android' : ios ? 'ios' : /Windows/i.test(ua) ? 'windows' : /Mac OS/i.test(ua) ? 'macos' : /Linux/i.test(ua) ? 'linux' : 'others';
  const browser = /Edg\//.test(ua) ? 'edge' : /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'others';
  return {
    'x-client-device': mobile ? 'mobile' : 'desktop', 'x-client-os': os, 'x-client-browser': browser,
    ...(mobile ? { 'x-client-rendering-type': native ? 'native' : /\bwv\b|WebView/i.test(ua) ? 'webview' : 'mweb' } : {}),
  };
}

export type UpiMode = 'intent' | 'qr' | 'collect';
export type CfUpiAttempt = {
  cfPaymentId: string; channel: string; action: string;
  /** upi:// style links per app (google_pay, phonepe, paytm, bhim, default) for mode intent. */
  links: Record<string, string>; url: string | null; qrImage: string | null; upiUri: string | null; collectExpiresAt: string | null;
};
const APP_KEYS: Record<string, string> = { gpay: 'google_pay', googlepay: 'google_pay', google_pay: 'google_pay', tez: 'google_pay', phonepe: 'phonepe', paytm: 'paytm', bhim: 'bhim', default: 'default', web: 'default' };

export async function payWithUpi(a: { sessionId: string; mode: UpiMode; upiId?: string; expiryMinutes?: number; hints: ClientHints }): Promise<CfUpiAttempt> {
  const channel = a.mode === 'intent' ? 'link' : a.mode === 'qr' ? 'qrcode' : 'collect';
  const upi = { channel, ...(a.mode === 'collect' ? { upi_id: a.upiId, upi_expiry_minutes: a.expiryMinutes ?? 5 } : {}) };
  const j = await cf<Record<string, any>>('POST', '/orders/sessions', { auth: false, body: { payment_session_id: a.sessionId, payment_method: { upi } }, headers: a.hints });
  const data = (j.data && typeof j.data === 'object' ? j.data : {}) as Record<string, any>;
  const payload = (data.payload && typeof data.payload === 'object' ? data.payload : {}) as Record<string, unknown>;
  const links: Record<string, string> = {};
  let qrImage: string | null = typeof data.qrcode === 'string' ? data.qrcode : null;
  let upiUri: string | null = null;
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== 'string' || !value) continue;
    if (/^data:image\//.test(value) || /^qr/i.test(key)) { qrImage ??= value.startsWith('data:') ? value : `data:image/png;base64,${value}`; continue; }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^upi:/i.test(value)) links[APP_KEYS[key.toLowerCase()] ?? key.toLowerCase()] = value;
  }
  upiUri = links.default ?? Object.values(links)[0] ?? null;
  return {
    cfPaymentId: String(j.cf_payment_id ?? ''), channel: String(j.channel ?? channel), action: String(j.action ?? ''),
    links, url: typeof data.url === 'string' ? data.url : null, qrImage, upiUri, collectExpiresAt: typeof data.expiry === 'string' ? data.expiry : null,
  };
}

// ---------------------------------------------------------------- refunds
export type CfRefundStatus = 'SUCCESS' | 'PENDING' | 'PENDING_APPROVAL' | 'CANCELLED' | 'ONHOLD' | 'REJECTED';
export type CfRefund = { refundId: string; cfRefundId: string | null; orderId: string; status: CfRefundStatus | string; amountMinor: number; description: string | null; arn: string | null };
const mapRefund = (j: Record<string, any>): CfRefund => ({
  refundId: String(j.refund_id ?? ''), cfRefundId: j.cf_refund_id != null ? String(j.cf_refund_id) : null, orderId: String(j.order_id ?? ''),
  status: String(j.refund_status ?? '').toUpperCase(), amountMinor: paise(j.refund_amount), description: short(j.status_description, 200) || null, arn: short(j.refund_arn, 60) || null,
});

/** Our refund id for Cashfree (3-40 characters, letters/digits/_/-): a hash of what makes the refund unique, so the same refund always has the same id. */
export async function cashfreeRefundId(...parts: (string | number)[]): Promise<string> {
  return `olr_${(await sha256(`ol-refund|${parts.join('|')}`)).slice(0, 24)}`;
}

export async function createCfRefund(a: { orderId: string; refundId: string; amountMinor: number; note: string; speed?: 'STANDARD' | 'INSTANT' }): Promise<CfRefund> {
  const body = { refund_amount: a.amountMinor / 100, refund_id: a.refundId, refund_note: a.note.trim().padEnd(3, '.').slice(0, 100), refund_speed: a.speed ?? 'STANDARD' };
  try {
    return mapRefund(await cf('POST', `/orders/${encodeURIComponent(a.orderId)}/refunds`, { body, idempotency: await idempotencyUuid(`refund:${a.refundId}`) }));
  } catch (error) {
    // The same refund id again (the first call worked but its answer was lost): read the refund that exists instead of making another.
    if (error instanceof CashfreeError && (error.status === 409 || /refund_already_exist|duplicate|already/i.test(`${error.code} ${error.message}`))) {
      try { return await fetchCfRefund(a.orderId, a.refundId); } catch { /* fall through to the original error */ }
    }
    throw error;
  }
}
export const fetchCfRefund = async (orderId: string, refundId: string): Promise<CfRefund> =>
  mapRefund(await cf('GET', `/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}`));

// ---------------------------------------------------------------- webhooks
const WEBHOOK_WINDOW_MS = 5 * 60_000;

/**
 * Checks a Cashfree webhook before anything in it is trusted: signature = base64(HMAC-SHA256(secret, x-webhook-timestamp + raw body)),
 * compared in constant time on the RAW bytes, and a timestamp no older (or newer) than five minutes. Returns the event id: the hash of
 * the signed body, which is identical on every retry of the same event (Cashfree resends the same bytes).
 */
export async function verifyCashfreeWebhook(raw: string, headers: Headers, now = Date.now()): Promise<{ eventId: string; timestampMs: number }> {
  const k = cashfreeKeys();
  if (!k.secret) throw new HttpError(503, 'Payment webhook is not set up', undefined, 'online_payments_off');
  const timestamp = headers.get('x-webhook-timestamp') ?? '';
  if (!timestamp || !(await signatureBase64Ok(k.secret, timestamp + raw, headers.get('x-webhook-signature')))) throw new HttpError(400, 'Invalid signature', undefined, 'bad_signature');
  const n = Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, 'Invalid timestamp', undefined, 'bad_timestamp');
  const ms = n < 1e12 ? n * 1000 : n; // Cashfree sends milliseconds; seconds are accepted too
  if (Math.abs(now - ms) > WEBHOOK_WINDOW_MS) throw new HttpError(400, 'Stale webhook', undefined, 'stale_timestamp');
  return { eventId: `body:${await sha256(raw)}`, timestampMs: ms };
}
