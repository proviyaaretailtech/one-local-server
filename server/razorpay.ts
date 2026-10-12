// The one place that talks to Razorpay's API with the account keys (Orders, Payments, Refunds). payments.ts uses it for checkout
// and refunds.ts for money going back; keeping it here lets both use it without importing each other.
import { features } from './features';
import { HttpError } from './http';

const RAZORPAY = 'https://api.razorpay.com/v1';
export const razorpayKeys = () => ({
  id: process.env.RAZORPAY_KEY_ID?.trim() ?? '',
  secret: process.env.RAZORPAY_KEY_SECRET?.trim() ?? '',
  webhook: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? '',
});

export function requireKeys() {
  const k = razorpayKeys();
  if (!features().online_payments || !k.id || !k.secret) throw new HttpError(503, 'Online payment is not available right now. Please choose Pay on delivery.', undefined, 'online_payments_off');
  return k;
}

const short = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function razorpay<T>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const k = requireKeys();
  const r = await fetch(`${RAZORPAY}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Basic ${btoa(`${k.id}:${k.secret}`)}`, 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok) {
    // Only Razorpay's error code and short description are logged, never a payload.
    console.error('[payments] razorpay', path.split('/')[1], r.status, json?.error?.code, short(json?.error?.description, 200));
    throw new HttpError(502, 'Could not reach the payment service. No money was taken. Please try again.');
  }
  return json as T;
}

// ---------- Refunds: a thin interface so the refund worker can be tested without the network ----------
// The worker (refunds.ts completeQueuedRefunds) only ever talks to a RefundGateway. The real one calls Razorpay and exists only when the
// RAZORPAY keys and the online_payments feature are on; tests install a fake with setRefundGateway(). Nothing here runs without keys.
// Cashfree is a RefundGateway too (payment-provider.ts cashfreeRefundGateway): it needs the order id the payment was made on and its own
// refund id, and answers with the gateway's status (SUCCESS, PENDING, ...), which the worker books through ol_refund_provider_update.
export type GatewayRefund = { id: string; status?: string; providerRefundId?: string };
export interface RefundGateway {
  /** Refund `amountMinor` (paise) of `paymentId`. `idempotencyKey` is stable per refund: a retry returns the same Razorpay refund, never a second one. */
  createRefund(args: { paymentId: string; amountMinor: number; idempotencyKey: string; notes: Record<string, string>; providerOrderId?: string; refundId?: string; speed?: 'STANDARD' | 'INSTANT' }): Promise<GatewayRefund>;
}

export const razorpayRefundGateway: RefundGateway = {
  createRefund: ({ paymentId, amountMinor, idempotencyKey, notes }) =>
    razorpay<GatewayRefund>(`/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountMinor, speed: 'normal', notes }, { 'X-Refund-Idempotency': idempotencyKey }),
};

let injected: RefundGateway | null = null;
/** Tests only: replace the gateway (pass null to restore the real one). */
export function setRefundGateway(gateway: RefundGateway | null) { injected = gateway; }
/** The gateway a test installed, if any (it stands in for every provider). */
export const injectedRefundGateway = () => injected;
/** The gateway to use now, or null when none is available (no keys and nothing injected): the worker then does nothing and burns no attempts. */
export function refundGateway(): RefundGateway | null {
  if (injected) return injected;
  const k = razorpayKeys();
  return features().online_payments && k.id && k.secret ? razorpayRefundGateway : null;
}
