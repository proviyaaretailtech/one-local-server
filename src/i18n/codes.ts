// Status words, payment words and API errors arrive from the server as CODES. Screens never print a code and
// never keep their own word list: they ask here for the catalogue key, then t() it:
//
//   t(orderStatusKey(order.status))        -> "Out for delivery" / "डिलीवरी के लिए निकला"
//   t(paymentStatusKey(order.payment_status))
//   t(paymentMethodKey(order.payment_method))
//   errorMessage(t, error)                 -> a translated sentence for whatever the API threw
//
// An unknown code gets a neutral label ("Status updating"), never the raw code and never a blank.
import type { TFunction } from 'i18next';

export const ORDER_STATUSES = ['placed', 'accepted', 'packed', 'out', 'delivered', 'cancelled'] as const;
export const PAYMENT_STATUSES = ['not_charged', 'pending', 'paid', 'failed', 'refunded'] as const;
export const PAYMENT_METHODS = ['cod', 'upi', 'card', 'netbanking', 'wallet', 'paylater', 'emi'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type PaymentMethodCode = (typeof PAYMENT_METHODS)[number];

export type OrderStatusKey = `status.order.${OrderStatus}` | 'status.order.unknown';
export type PaymentStatusKey = `status.payment.${PaymentStatus}` | 'status.payment.unknown';
export type PaymentMethodKey = `status.method.${PaymentMethodCode}` | 'status.method.unknown';

// Other spellings the server or an older build might send, folded into the canonical code.
const ORDER_ALIASES: Record<string, OrderStatus> = { confirmed: 'accepted', preparing: 'packed', out_for_delivery: 'out', canceled: 'cancelled' };
const METHOD_ALIASES: Record<string, PaymentMethodCode> = { cardless_emi: 'emi', cash: 'cod', netbank: 'netbanking' };

const norm = (code: unknown) => (typeof code === 'string' ? code.trim().toLowerCase() : '');

export function orderStatusKey(code: unknown): OrderStatusKey {
  const c = norm(code);
  const canonical = (ORDER_STATUSES as readonly string[]).includes(c) ? (c as OrderStatus) : ORDER_ALIASES[c];
  return canonical ? `status.order.${canonical}` : 'status.order.unknown';
}
export function paymentStatusKey(code: unknown): PaymentStatusKey {
  const c = norm(code);
  return (PAYMENT_STATUSES as readonly string[]).includes(c) ? `status.payment.${c as PaymentStatus}` : 'status.payment.unknown';
}
export function paymentMethodKey(code: unknown): PaymentMethodKey {
  const c = norm(code);
  const canonical = (PAYMENT_METHODS as readonly string[]).includes(c) ? (c as PaymentMethodCode) : METHOD_ALIASES[c];
  return canonical ? `status.method.${canonical}` : 'status.method.unknown';
}

// ── API errors ─────────────────────────────────────────────────────────────────────────────────────────────
// The customer routes answer { detail, code }. Most carry no code yet; those fall back to the HTTP status.
export const ERROR_CODES = [
  'validation', 'invalid_payload', 'invalid_request', 'not_found', 'unauthorized', 'rate_limited', 'wrong_state', 'conflict', 'version_conflict',
  'idempotency_mismatch', 'database_unavailable', 'server_error', 'not_configured', 'provider_not_configured', 'coming_soon',
  'outside_delivery_area', 'out_of_zone', 'address_needs_point', 'merchant_unavailable', 'switched_to_cash', 'order_not_deliverable',
  'upload_unavailable', 'upload_missing', 'offline', 'timeout',
  // Online payment (docs/PAYMENTS.md "App API (Cashfree)")
  'choose_method', 'phone_required', 'price_changed', 'payment_in_progress', 'gateway_unavailable', 'online_payments_off',
  'session_expired', 'upi_id_invalid', 'upi_direct_unavailable',
  // Whole-app blocks (src/network/app-blocked-state.ts): HTTP 426, and 503 with code 'maintenance'
  'update_required', 'maintenance',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export type ErrorKey = `errors.code.${ErrorCode}` | 'errors.generic';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'validation', 426: 'update_required', 401: 'unauthorized', 403: 'unauthorized', 404: 'not_found', 409: 'conflict', 413: 'validation', 422: 'validation',
  429: 'rate_limited', 500: 'server_error', 502: 'server_error', 503: 'server_error', 504: 'timeout',
};

type ErrorLike = { code?: unknown; status?: unknown; message?: unknown; name?: unknown; detail?: unknown };

/** The catalogue key for an API failure: its code, else its HTTP status, else a network failure, else the generic line. */
export function errorKey(error: unknown): ErrorKey {
  const e = (error && typeof error === 'object' ? error : {}) as ErrorLike;
  const code = norm(e.code);
  if ((ERROR_CODES as readonly string[]).includes(code)) return `errors.code.${code as ErrorCode}`;
  if (typeof e.status === 'number' && STATUS_TO_CODE[e.status]) return `errors.code.${STATUS_TO_CODE[e.status]}`;
  // fetch() itself failed: no connection, DNS, or a dropped request.
  const message = typeof e.message === 'string' ? e.message : '';
  if (e.name === 'AbortError' || /network request failed|failed to fetch|load failed|network error/i.test(message)) return 'errors.code.offline';
  return 'errors.generic';
}

/**
 * A sentence for the person. A known code or status is always translated. An unknown failure shows the
 * server's own English sentence only when the app is in English (nothing is lost there); in any other
 * language it shows the translated generic line rather than a sentence they cannot read.
 */
export function errorMessage(t: TFunction, error: unknown, lng: string = 'en'): string {
  const key = errorKey(error);
  if (key === 'errors.generic' && lng === 'en') {
    const e = (error && typeof error === 'object' ? error : {}) as ErrorLike;
    const text = typeof e.message === 'string' ? e.message : '';
    if (text && !/^API \//.test(text)) return text; // "API /path 500" is a developer line, never shown
  }
  return t(key);
}
