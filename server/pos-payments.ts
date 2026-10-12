// Guest-bill / POS online payments through Cashfree (migration 0239; contract: "One Local Delivery app /docs/PAYMENTS_CASHFREE.md", "As built").
//
//   POST /api/partner/payments/online                      startOnlinePayment   opens one Cashfree order for an amount <= what is still due on the bill
//   GET  /api/partner/payments/online/{attempt_id}         onlinePaymentStatus  our row; if still pending it re-reads Cashfree first (never the browser)
//   POST /api/partner/payments/online/{attempt_id}/refund  refundOnlinePayment  money back, capped at what was paid, never twice
//   POST /api/payments/webhook (existing route)            handlePosPaymentEvent / handlePosRefundEvent: order ids 'olp-...' and refund ids 'olpr_...' land here
//   sweepPosOnlinePayments                                 re-reads attempts still open after 2 minutes (a lost webhook; a laptop cannot receive one)
//
// The Cashfree client and the webhook verifier are the ones in cashfree.ts / payment-provider.ts: nothing here talks to Cashfree except through them.
// The database owns the rules (amount <= due, idempotency, one booking per cf_payment_id, refund cap): see online_payment_apply() and friends in 0239.
// A staff session authorises every call (the same Bearer token the partner app already sends; requirePartnerAuth); the DB re-checks the actor's role.
import { db, dbConfigured } from './db';
import { HttpError } from './http';
import { CashfreeError, gatewayDown, type CfPayment } from './cashfree';
import { cashfreeProvider, type ProviderPaymentInfo } from './payment-provider';
import { features } from './features';
import { publicBase } from './cashfree-checkout';
import type { Staff } from './partner';

const SESSION_MINUTES = 30;
const POLL = { every_ms: 3000, give_up_after_ms: 300_000 };
const PAY_ROLES = ['org_owner', 'org_admin', 'manager', 'biller', 'business_manager', 'location_manager', 'finance_manager'];
const REFUND_ROLES = ['org_owner', 'org_admin', 'manager', 'business_manager', 'location_manager', 'finance_manager'];
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

type Row = Record<string, any>;

// ---------------------------------------------------------------- database errors -> HTTP
const PAY_ERRORS: Record<string, { status: number; code: string }> = {
  PAY_BAD_REQUEST: { status: 400, code: 'bad_request' }, PAY_FORBIDDEN: { status: 403, code: 'forbidden' }, PAY_NOT_FOUND: { status: 404, code: 'not_found' },
  PAY_ORDER_CLOSED: { status: 409, code: 'order_closed' }, PAY_WRONG_STATE: { status: 409, code: 'wrong_state' },
  PAY_AMOUNT_EXCEEDS_DUE: { status: 422, code: 'amount_exceeds_due' }, PAY_BELOW_MINIMUM: { status: 422, code: 'amount_below_minimum' },
  PAY_IDEMPOTENCY_MISMATCH: { status: 422, code: 'idempotency_mismatch' }, PAY_REFUND_EXCEEDS_PAID: { status: 422, code: 'refund_exceeds_paid' },
};
async function rpc<T = Row>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!dbConfigured()) throw new HttpError(503, 'The database is not connected yet.', undefined, 'database_unavailable');
  const { data, error } = await db().rpc(fn, { p: args }); // every function takes one jsonb parameter named p
  if (error) {
    const m = String(error.message ?? '').match(/^(PAY_[A-Z_]+):\s*(.*)$/);
    if (m && PAY_ERRORS[m[1]]) {
      const due = m[2].match(/still due is ([0-9.]+)/);
      const e = new HttpError(PAY_ERRORS[m[1]].status, m[2] || 'Request refused', undefined, PAY_ERRORS[m[1]].code);
      if (due) e.extra = { due: Number(due[1]) };
      throw e;
    }
    console.error('[pos-payments]', fn, { code: error.code, message: String(error.message ?? '').slice(0, 200) });
    throw new HttpError(500, 'Something went wrong. Please try again.');
  }
  return data as T;
}

function requireStaff(staff: Staff, body: Row | null, roles: string[], what: string) {
  if (!roles.includes(staff.role)) throw new HttpError(403, `Your role cannot ${what}.`, undefined, 'forbidden');
  const org = text(body?.organization_id, 64);
  if (org && org !== staff.organizationId) throw new HttpError(403, 'That restaurant is not yours.', undefined, 'wrong_organization');
}
function onlineOn() {
  if (!features().online_payments || !cashfreeProvider.configured()) throw new HttpError(503, 'Online payment is not available right now. Take cash, UPI or card at the counter.', undefined, 'online_payments_off');
}
const paise = (rupees: unknown) => Math.round(Number(rupees) * 100);
const normalisePhone = (raw: string) => { const d = raw.replace(/\D/g, ''); return d.length === 12 && d.startsWith('91') ? d.slice(2) : d; };
const cashfreeEnv = () => (process.env.CASHFREE_ENV?.trim().toLowerCase() === 'production' ? 'production' : 'sandbox');

const MESSAGES: Record<string, string> = {
  pending: 'We are confirming with the bank. Do not pay again.',
  paid: 'Payment received.',
  failed: 'The payment did not go through. No money was taken. You can try again.',
  dropped: 'The payment window was closed. No money was taken. You can try again.',
  expired: 'The payment time ran out. No money was taken. You can try again.',
  overpaid: 'The payment arrived after the bill was already settled. It is being refunded to the payer.',
};
/** The attempt as the app sees it. Never carries the payer's number or anything from Cashfree's payload. */
function view(a: Row, extra: Row = {}): Row {
  return {
    attempt_id: a.attempt_id, status: a.status, outcome: a.outcome, recorded: !!a.recorded, amount: Number(a.amount), amount_minor: Number(a.amount_minor),
    order_ids: a.order_ids, due: a.due == null ? undefined : Number(a.due), provider: 'cashfree', provider_order_id: a.provider_order_id,
    provider_payment_id: a.provider_payment_id ?? null, payment_group: a.payment_group ?? null, failure_code: a.failure_code ?? null,
    message: MESSAGES[a.outcome as string] ?? null, expires_at: a.expires_at, paid_at: a.paid_at ?? null, refunded_minor: Number(a.refunded_minor ?? 0),
    replayed: a.replayed ?? undefined, ...extra,
  };
}

// ---------------------------------------------------------------- POST /api/partner/payments/online
export async function startOnlinePayment(request: Request, staff: Staff, body: Row) {
  requireStaff(staff, body, PAY_ROLES, 'take payments');
  onlineOn();
  const orderIds = Array.isArray(body.order_ids) ? body.order_ids.map(v => text(v, 64)) : [];
  const key = text(body.idempotency_key, 120) || text(request.headers.get('idempotency-key'), 120);
  const phone = text(body.payer_phone, 20);
  const a = await rpc('pos_start_online_payment', {
    organization_id: staff.organizationId, actor_user_id: staff.userId, order_ids: orderIds, amount: body.amount, idempotency_key: key, payer_phone: phone,
  });
  // A repeat of a finished attempt answers its state and opens nothing.
  if (!['created', 'pending'].includes(a.status)) return view(a, { payment_session_id: null, link_url: null, poll: POLL });
  // The Cashfree order id is ours (olp-<attempt>), so opening it again after a lost reply reads the same order back instead of making a second one.
  const base = publicBase(request);
  let order;
  try {
    order = await cashfreeProvider.createOrder({
      orderId: a.provider_order_id, amountMinor: Number(a.amount_minor), customerId: `pos${String(a.attempt_id).replace(/-/g, '').slice(0, 24)}`, phone: normalisePhone(phone),
      returnUrl: `${base}/api/partner/payments/return?attempt=${encodeURIComponent(a.attempt_id)}`,
      ...(base.startsWith('https://') ? { notifyUrl: `${base}/api/payments/webhook` } : {}),
      expiresAt: new Date(a.expires_at ? Date.parse(a.expires_at) : Date.now() + SESSION_MINUTES * 60_000),
      note: `Table bill ${String(a.attempt_id).slice(0, 8).toUpperCase()}`, tags: { attempt_id: a.attempt_id, source: 'pos' },
    });
  } catch (error) {
    if (error instanceof CashfreeError) {
      await rpc('online_payment_attach', { provider_order_id: a.provider_order_id, failed: true }).catch(() => undefined);
      throw gatewayDown();
    }
    throw error;
  }
  const attached = await rpc('online_payment_attach', { provider_order_id: a.provider_order_id, provider_ref: order.providerRef, expires_at: order.expiresAt });
  return view({ ...attached, due: a.due, replayed: a.replayed }, { payment_session_id: order.sessionId, link_url: null, environment: cashfreeEnv(), poll: POLL });
}

// ---------------------------------------------------------------- GET /api/partner/payments/online/{attempt_id}
export async function onlinePaymentStatus(_request: Request, staff: Staff, attemptId: string) {
  requireStaff(staff, null, [...PAY_ROLES, 'accountant', 'operations_manager'], 'see payments');
  const args = { organization_id: staff.organizationId, actor_user_id: staff.userId, attempt_id: text(attemptId, 64) };
  let a = await rpc('pos_online_payment_status', args);
  if (a.check_due && cashfreeProvider.configured()) {
    await reconcileAttempt(a.provider_order_id, 'poll');
    a = await rpc('pos_online_payment_status', args);
  }
  return view(a, { poll_after_ms: a.outcome === 'pending' ? POLL.every_ms : null, retry_ok: ['failed', 'dropped', 'expired'].includes(a.outcome) });
}

/** Asks Cashfree what happened to an order and hands what it reports to the one writer. Cashfree unreachable = the stored state stands. */
export async function reconcileAttempt(providerOrderId: string, source: 'poll' | 'webhook' = 'poll'): Promise<void> {
  let payments: ProviderPaymentInfo[], status: string;
  try {
    [payments, status] = await Promise.all([cashfreeProvider.fetchPayments(providerOrderId), cashfreeProvider.fetchOrder(providerOrderId).then(o => o.status)]);
  } catch { return; }
  const send = (event: string, payment?: ProviderPaymentInfo) => applyEvent({ providerOrderId, event, payment, source });
  const success = payments.find(p => p.status === 'success');
  if (success) { await send('success', success); return; }
  if (payments.some(p => p.status === 'pending')) { await send('pending'); return; }
  const last = [...payments].reverse().find(p => p.status === 'failed' || p.status === 'dropped');
  if (status === 'expired' || status === 'terminated') await send('expired');
  else if (last) await send(last.status === 'dropped' ? 'dropped' : 'failed', last);
}

type Applied = Row & { outcome: string };
async function applyEvent(a: { providerOrderId: string; event: string; payment?: Pick<ProviderPaymentInfo, 'id' | 'amountMinor' | 'group' | 'reference'>; source: 'poll' | 'webhook'; type?: string }): Promise<Applied> {
  const out = await rpc<Applied>('online_payment_apply', {
    provider_order_id: a.providerOrderId, event: a.event, cf_payment_id: a.payment?.id || null, amount_minor: a.payment?.amountMinor ?? null,
    payment_group: a.payment?.group ?? null, reference_masked: a.payment?.reference ?? null, source: a.source, event_type: a.type ?? null,
  });
  // Money Cashfree took that the bill could no longer accept goes straight back. A refund that cannot be made now stays needs_refund for operations.
  if (out.outcome === 'needs_refund') {
    try { await refundNow(out.attempt_id, out.organization_id, null, Number(out.amount_minor), `auto-over-${out.provider_payment_id}`, 'Bill was already settled', true); }
    catch (error) { console.error('[pos-payments] automatic refund of an unbookable payment did not complete', (error as HttpError)?.detail ?? (error as Error)?.message); }
  }
  return out;
}

// ---------------------------------------------------------------- POST /api/partner/payments/online/{attempt_id}/refund
type RefundBody = { amount?: unknown; amount_minor?: unknown; reason?: unknown; idempotency_key?: unknown; organization_id?: unknown };
export async function refundOnlinePayment(request: Request, staff: Staff, attemptId: string, body: RefundBody) {
  requireStaff(staff, body as Row, REFUND_ROLES, 'refund payments');
  onlineOn();
  const minor = body.amount_minor != null ? Number(body.amount_minor) : paise(body.amount);
  if (!Number.isInteger(minor) || minor <= 0) throw new HttpError(400, 'Enter the amount to refund.', undefined, 'bad_request');
  const key = text(body.idempotency_key, 120) || text(request.headers.get('idempotency-key'), 120);
  return refundNow(text(attemptId, 64), staff.organizationId, staff.userId, minor, key, text(body.reason, 100), false);
}

async function refundNow(attemptId: string, organizationId: string, actor: string | null, amountMinor: number, key: string, reason: string, system: boolean) {
  const r = await rpc('online_payment_refund_start', { organization_id: organizationId, actor_user_id: actor, attempt_id: attemptId, amount_minor: amountMinor, idempotency_key: key, reason, system });
  const base = { attempt_id: attemptId, refund_id: r.refund_id as string, amount: Number(r.amount_minor) / 100, amount_minor: Number(r.amount_minor), replayed: !!r.replayed };
  if (r.status === 'processed') return { ...base, status: 'processed' as const };
  let done;
  try {
    done = await cashfreeProvider.createRefund({ providerOrderId: r.provider_order_id, paymentId: null, amountMinor: Number(r.amount_minor), refundId: r.refund_id, speed: 'STANDARD', note: reason || 'Refund' });
  } catch (error) {
    if (error instanceof CashfreeError) {
      const rejected = error.status >= 400 && error.status < 500 && error.status !== 429;
      // Cashfree looked at it and said no: the reservation is released so another refund fits. Anything else (down, no answer): the same key retries safely.
      if (rejected) await rpc('online_payment_refund_update', { refund_id: r.refund_id, provider_status: 'REJECTED' }).catch(() => undefined);
      throw new HttpError(502, rejected ? `Cashfree refused the refund: ${error.message}`.slice(0, 200) : 'Could not reach the payment service. Nothing was refunded. Try again.', undefined, rejected ? 'refund_failed' : 'gateway_unavailable');
    }
    throw error;
  }
  const u = await rpc('online_payment_refund_update', { refund_id: r.refund_id, provider_refund_id: done.providerRefundId, provider_status: done.rawStatus });
  return { ...base, status: (u.status === 'processed' ? 'processed' : u.status === 'failed' ? 'failed' : 'pending') as 'processed' | 'failed' | 'pending', eta_text: '3-5 working days' };
}

/** REFUND_STATUS_WEBHOOK for a refund we made on a guest bill (refund ids start olpr_). */
export async function handlePosRefundEvent(refund: Row) {
  const refundId = text(refund.refund_id, 80);
  const orderId = text(refund.order_id, 64);
  const status = String(refund.refund_status ?? '').toUpperCase();
  try {
    await rpc('online_payment_refund_update', { refund_id: refundId, provider_refund_id: refund.cf_refund_id != null ? String(refund.cf_refund_id) : null, provider_status: status });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return { outcome: 'unknown_order' as const, providerOrderId: orderId };
    throw error;
  }
  return { outcome: 'processed' as const, providerOrderId: orderId, detail: `refund ${status}` };
}

// ---------------------------------------------------------------- the webhook (called by cashfree-checkout.ts for order ids starting 'olp-')
export async function handlePosPaymentEvent(type: string, orderId: string, payment: CfPayment) {
  const base = { providerOrderId: orderId, paymentId: payment.id, amountMinor: payment.amountMinor };
  const event = type === 'PAYMENT_SUCCESS' ? 'success' : type === 'PAYMENT_USER_DROPPED' ? 'dropped' : type === 'PAYMENT_FAILED' ? 'failed' : null;
  if (!event || (event === 'success' && payment.status !== 'success')) return { outcome: 'ignored' as const, detail: `event ${type} (${payment.rawStatus}) is not used here`, ...base };
  const out = await applyEvent({
    providerOrderId: orderId, event, source: 'webhook', type,
    payment: { id: payment.id, amountMinor: payment.amountMinor, group: payment.group, reference: payment.reference },
  });
  const extra = { ...base, onlinePaymentId: out.online_payment_id as string | undefined, organizationId: out.organization_id as string | undefined };
  switch (out.outcome) {
    case 'processed': return { outcome: 'processed' as const, ...extra };
    case 'replayed': return { outcome: 'duplicate' as const, detail: 'already recorded', ...extra };
    case 'unknown_order': return { outcome: 'unknown_order' as const, ...extra };
    case 'amount_mismatch': return { outcome: 'amount_mismatch' as const, detail: 'Cashfree amount differs from the attempt; nothing booked', ...extra };
    case 'duplicate_payment': return { outcome: 'duplicate_payment' as const, ...extra };
    case 'needs_refund': return { outcome: 'refunded_late' as const, detail: 'bill already settled; refund started', ...extra };
    default: return { outcome: 'ignored' as const, ...extra };
  }
}

// ---------------------------------------------------------------- the sweep
export async function sweepPosOnlinePayments(limitRows = 40): Promise<{ checked: number; paid: number }> {
  const out = { checked: 0, paid: 0 };
  if (!cashfreeProvider.configured() || !dbConfigured()) return out;
  const now = Date.now();
  const { data, error } = await db().from('online_payments').select('provider_order_id, status').in('status', ['created', 'pending'])
    .lt('created_at', new Date(now - 2 * 60_000).toISOString()).gt('created_at', new Date(now - 24 * 3600_000).toISOString()).order('created_at').limit(limitRows);
  if (error) { console.error('[pos-payments] sweep could not list open attempts', error.message); return out; }
  for (const row of data ?? []) {
    out.checked++;
    await reconcileAttempt(row.provider_order_id as string, 'poll');
    const { data: after } = await db().from('online_payments').select('status').eq('provider_order_id', row.provider_order_id).maybeSingle();
    if (after?.status === 'paid') out.paid++;
  }
  return out;
}
