// One small interface over the payment gateways, so checkout, status checks, refunds and webhooks never care which gateway took the money.
// Active provider by environment: Cashfree if CASHFREE_PG_APP_ID + CASHFREE_PG_SECRET_KEY are set, else Razorpay if its keys are set, else
// none (cash on delivery only, exactly as before). The provider that took a payment is stored on the checkout (ol_checkouts.payment_provider)
// and that same provider makes its refunds, whatever the active provider is today.
//
//   createOrder   open an order for the checkout total          fetchOrder    read it back (status, session id while active)
//   fetchPayments the attempts made on that order               createRefund  money back, deterministic refund id, no double refund
//   fetchRefund   the gateway's current word on a refund        verifyWebhook signature + replay check on the raw request
import {
  CashfreeError, cashfreeConfigured, createCfOrder, createCfRefund, fetchCfOrder, fetchCfPayments, fetchCfRefund, gatewayDown, verifyCashfreeWebhook,
  type CfPaymentStatus,
} from './cashfree';
import { features } from './features';
import { HttpError, signatureOk } from './http';
import { injectedRefundGateway, razorpay, razorpayKeys, refundGateway as razorpayOrInjectedGateway, type GatewayRefund, type RefundGateway } from './razorpay';
import type { PaymentMethod, PaymentProviderName } from './store';

export type ProviderOrderInfo = {
  providerOrderId: string; providerRef: string | null; status: 'active' | 'paid' | 'expired' | 'terminated' | 'unknown';
  sessionId: string | null; expiresAt: string | null; amountMinor: number;
};
export type ProviderPaymentInfo = {
  id: string; status: CfPaymentStatus; amountMinor: number; method: PaymentMethod | undefined; group: string | null;
  reference: string | null; message: string | null; time: string | null; errorDescription: string | null;
};
export type ProviderRefundInfo = { refundId: string; providerRefundId: string | null; status: 'success' | 'pending' | 'failed'; rawStatus: string; amountMinor: number; description: string | null };

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  configured(): boolean;
  createOrder(a: {
    orderId: string; amountMinor: number; customerId: string; phone: string; name?: string; email?: string;
    returnUrl: string; notifyUrl?: string; expiresAt: Date; note: string; tags?: Record<string, string>;
  }): Promise<ProviderOrderInfo>;
  fetchOrder(providerOrderId: string): Promise<ProviderOrderInfo>;
  fetchPayments(providerOrderId: string): Promise<ProviderPaymentInfo[]>;
  createRefund(a: { providerOrderId: string; paymentId: string | null; amountMinor: number; refundId: string; speed: 'STANDARD' | 'INSTANT'; note: string }): Promise<ProviderRefundInfo>;
  fetchRefund(a: { providerOrderId: string; paymentId: string | null; refundId: string; providerRefundId?: string | null }): Promise<ProviderRefundInfo>;
  /** Throws HttpError 400 for a bad signature or a stale timestamp; otherwise answers the id this event is de-duplicated on. */
  verifyWebhook(raw: string, headers: Headers): Promise<{ eventId: string }>;
}

// ---------------------------------------------------------------- Cashfree
const cfOrderStatus = (s: string): ProviderOrderInfo['status'] =>
  s === 'ACTIVE' ? 'active' : s === 'PAID' ? 'paid' : s === 'EXPIRED' ? 'expired' : s === 'TERMINATED' || s === 'TERMINATION_REQUESTED' ? 'terminated' : 'unknown';
const cfRefundStatus = (s: string): ProviderRefundInfo['status'] => (s === 'SUCCESS' ? 'success' : s === 'CANCELLED' || s === 'REJECTED' ? 'failed' : 'pending');

export const cashfreeProvider: PaymentProvider = {
  name: 'cashfree',
  configured: cashfreeConfigured,
  async createOrder(a) {
    const o = await createCfOrder(a);
    return { providerOrderId: o.orderId, providerRef: o.cfOrderId, status: cfOrderStatus(o.status), sessionId: o.sessionId, expiresAt: o.expiresAt, amountMinor: o.amountMinor };
  },
  async fetchOrder(id) {
    const o = await fetchCfOrder(id);
    return { providerOrderId: o.orderId, providerRef: o.cfOrderId, status: cfOrderStatus(o.status), sessionId: o.sessionId, expiresAt: o.expiresAt, amountMinor: o.amountMinor };
  },
  async fetchPayments(id) {
    return (await fetchCfPayments(id)).map(p => ({ id: p.id, status: p.status, amountMinor: p.amountMinor, method: p.method, group: p.group, reference: p.reference, message: p.message, time: p.time, errorDescription: p.errorDescription }));
  },
  async createRefund(a) {
    const r = await createCfRefund({ orderId: a.providerOrderId, refundId: a.refundId, amountMinor: a.amountMinor, note: a.note, speed: a.speed });
    return { refundId: r.refundId || a.refundId, providerRefundId: r.cfRefundId, status: cfRefundStatus(r.status), rawStatus: r.status, amountMinor: r.amountMinor || a.amountMinor, description: r.description };
  },
  async fetchRefund(a) {
    const r = await fetchCfRefund(a.providerOrderId, a.refundId);
    return { refundId: r.refundId || a.refundId, providerRefundId: r.cfRefundId, status: cfRefundStatus(r.status), rawStatus: r.status, amountMinor: r.amountMinor, description: r.description };
  },
  verifyWebhook: async (raw, headers) => ({ eventId: (await verifyCashfreeWebhook(raw, headers)).eventId }),
};

// ---------------------------------------------------------------- Razorpay (unchanged behaviour, behind the same interface)
const rzpOrderStatus = (s: unknown): ProviderOrderInfo['status'] => (s === 'paid' ? 'paid' : s === 'created' || s === 'attempted' ? 'active' : 'unknown');
type RzpOrder = { id: string; amount: number; status?: string };
type RzpPayment = { id: string; amount: number; method?: string; status?: string; description?: string; error_description?: string };
const rzpPaymentStatus = (s: unknown): CfPaymentStatus => (s === 'captured' || s === 'authorized' ? 'success' : s === 'failed' ? 'failed' : 'pending');
const rzpRefundStatus = (s: unknown): ProviderRefundInfo['status'] => (s === 'processed' ? 'success' : s === 'failed' ? 'failed' : 'pending');
const KNOWN_METHODS: PaymentMethod[] = ['upi', 'card', 'netbanking', 'wallet', 'paylater', 'emi', 'cardless_emi'];

export const razorpayProvider: PaymentProvider = {
  name: 'razorpay',
  configured: () => { const k = razorpayKeys(); return features().online_payments && !!k.id && !!k.secret; },
  async createOrder(a) {
    const o = await razorpay<RzpOrder>('/orders', { amount: a.amountMinor, currency: 'INR', receipt: a.orderId, notes: a.tags ?? {} });
    return { providerOrderId: o.id, providerRef: o.id, status: 'active', sessionId: null, expiresAt: null, amountMinor: o.amount };
  },
  async fetchOrder(id) {
    const o = await razorpay<RzpOrder>(`/orders/${encodeURIComponent(id)}`);
    return { providerOrderId: o.id, providerRef: o.id, status: rzpOrderStatus(o.status), sessionId: null, expiresAt: null, amountMinor: o.amount };
  },
  async fetchPayments(id) {
    const r = await razorpay<{ items?: RzpPayment[] }>(`/orders/${encodeURIComponent(id)}/payments`);
    return (r.items ?? []).map(p => ({
      id: p.id, status: rzpPaymentStatus(p.status), amountMinor: p.amount, method: KNOWN_METHODS.includes(p.method as PaymentMethod) ? p.method as PaymentMethod : undefined,
      group: p.method ?? null, reference: null, message: null, time: null, errorDescription: p.error_description ?? null,
    }));
  },
  async createRefund(a) {
    if (!a.paymentId) throw new HttpError(409, 'No payment id on file for this refund.');
    const r = await razorpay<{ id: string; status?: string; amount?: number }>(`/payments/${encodeURIComponent(a.paymentId)}/refund`,
      { amount: a.amountMinor, speed: 'normal', notes: { reason: a.note.slice(0, 100) } }, { 'X-Refund-Idempotency': a.refundId });
    return { refundId: a.refundId, providerRefundId: r.id, status: rzpRefundStatus(r.status), rawStatus: String(r.status ?? ''), amountMinor: r.amount ?? a.amountMinor, description: null };
  },
  async fetchRefund(a) {
    const r = await razorpay<{ id: string; status?: string; amount?: number }>(`/refunds/${encodeURIComponent(a.providerRefundId ?? a.refundId)}`);
    return { refundId: a.refundId, providerRefundId: r.id, status: rzpRefundStatus(r.status), rawStatus: String(r.status ?? ''), amountMinor: r.amount ?? 0, description: null };
  },
  async verifyWebhook(raw, headers) {
    const secret = razorpayKeys().webhook;
    if (!secret) throw new HttpError(503, 'Payment webhook is not set up');
    if (!(await signatureOk(secret, raw, headers.get('x-razorpay-signature')))) throw new HttpError(400, 'Invalid signature', undefined, 'bad_signature');
    return { eventId: headers.get('x-razorpay-event-id')?.slice(0, 100) ?? '' };
  },
};

// ---------------------------------------------------------------- cash on delivery rule
export type CodRule = { available: boolean; reason: 'disabled' | 'over_limit' | null; max_total: number | null; note: string };
/**
 * Whether a basket of `total` rupees may be paid in cash at the door. FEATURE_COD=off turns cash off; COD_MAX_TOTAL (rupees, optional) caps
 * the basket. Checked by GET /payments/methods (what to show) AND by the checkout itself (what is allowed): the app holds no rule of its own.
 */
export function codRule(total: number | null): CodRule {
  const note = 'Pay cash to the rider at your door, keep exact change';
  if (process.env.FEATURE_COD?.trim().toLowerCase() === 'off') return { available: false, reason: 'disabled', max_total: null, note };
  const max = Number(process.env.COD_MAX_TOTAL);
  const cap = Number.isFinite(max) && max > 0 ? max : null;
  if (cap != null && total != null && total > cap) return { available: false, reason: 'over_limit', max_total: cap, note };
  return { available: true, reason: null, max_total: cap, note };
}

// ---------------------------------------------------------------- selection
export function providerByName(name: PaymentProviderName | null | undefined): PaymentProvider | null {
  const p = name === 'cashfree' ? cashfreeProvider : name === 'razorpay' ? razorpayProvider : null;
  return p?.configured() ? p : null;
}
/** The provider new payments go through today: Cashfree, else Razorpay, else null (cash only). FEATURE_ONLINE_PAYMENTS=off turns both off. */
export function activeProvider(): PaymentProvider | null {
  if (!features().online_payments) return null;
  return cashfreeProvider.configured() ? cashfreeProvider : razorpayProvider.configured() ? razorpayProvider : null;
}
/** Which provider took (or will take) the money for a stored checkout. Rows older than 0238 have none and were Razorpay. */
export const providerOf = (record: { payment_provider: PaymentProviderName | null; razorpay_order_id: string | null }): PaymentProviderName =>
  record.payment_provider ?? (record.razorpay_order_id ? 'razorpay' : activeProvider()?.name ?? 'razorpay');

// ---------------------------------------------------------------- refund gateways (what the refund worker calls)
/** Cashfree as a RefundGateway. `providerOrderId` is the order the payment was made on; `refundId` our deterministic id for this refund. */
export const cashfreeRefundGateway: RefundGateway = {
  async createRefund({ providerOrderId, refundId, amountMinor, notes, speed }): Promise<GatewayRefund> {
    if (!providerOrderId || !refundId) throw new HttpError(409, 'No Cashfree order on file for this refund: refund it by hand.');
    try {
      const r = await cashfreeProvider.createRefund({ providerOrderId, paymentId: null, amountMinor, refundId, speed: speed ?? 'STANDARD', note: notes.reason || 'Refund' });
      return { id: r.refundId, status: r.rawStatus, providerRefundId: r.providerRefundId ?? undefined };
    } catch (error) {
      if (error instanceof CashfreeError) {
        // 4xx = Cashfree looked at the refund and said no (retry under a new id via the queue). 5xx / no answer = try again with the same id.
        const rejected = error.status >= 400 && error.status < 500 && error.status !== 429;
        throw new HttpError(502, `Cashfree ${rejected ? 'refused' : 'could not make'} the refund (${error.status} ${error.code || error.type}): ${error.message}`.slice(0, 280), undefined, rejected ? 'refund_failed' : 'gateway_unavailable');
      }
      throw error;
    }
  },
};
/** The gateway that must refund a payment taken by `name`: a test's injected fake stands in for every provider; otherwise the real one, if configured. */
export function refundGatewayFor(name: PaymentProviderName): RefundGateway | null {
  if (injectedRefundGateway()) return injectedRefundGateway();
  if (name === 'cashfree') return cashfreeConfigured() && features().online_payments ? cashfreeRefundGateway : null;
  return razorpayOrInjectedGateway();
}
/** Is any refund gateway available at all? The worker claims nothing (and burns no attempts) when this is false. */
export const anyRefundGateway = () => !!(injectedRefundGateway() || (cashfreeConfigured() && features().online_payments) || razorpayOrInjectedGateway());
export { gatewayDown };
