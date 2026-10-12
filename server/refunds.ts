// Money going back to a customer when an order cannot be fulfilled (SRV-2) or a payment arrives that should not have (SRV-3).
//
// The rule: a customer is never left charged for food nobody will cook. When a paid online order cannot be handed to a restaurant
// it is cancelled and refunded through Razorpay at once; if Razorpay cannot be reached right then, the order stays in a "refund
// due" state (cancelled, paid online, never adopted, no processed refund) and the dispatch sweep keeps retrying it, so the money
// is not forgotten. A cash order has nothing to refund: it is just cancelled so it does not sit as "placed" for ever.
//
// Why not the ol_process_refund database function: it only accepts an order that was accepted, packed, out or delivered, so it
// refuses exactly these orders (still "placed"/"cancelled"). The refund is therefore made at Razorpay and booked in ol_refunds the
// same way a refund made in the Razorpay dashboard is (store.ts recordGatewayRefund), keyed on Razorpay's refund id so the later
// refund.processed webhook finds it and cannot book it twice. (db-requests-server.md asks for the function to accept these orders.)
//
// Cashfree (0238): a refund goes back through the provider that TOOK the payment (ol_checkouts.payment_provider), whichever provider is
// active today. A Cashfree refund is made against the checkout's Cashfree order with our own deterministic refund id (cashfreeRefundId), is
// never refunded beyond the amount paid (cumulative cap across the whole checkout), and is "gateway_pending" until Cashfree confirms it by
// webhook or poll (ol_refund_provider_update). A failed refund stays in the queue (ol_refund_requeue_failed) and, after the last try, in an
// operations exception. A cash order never reaches the gateway.
import { db, fromDbError } from './db';
import { HttpError } from './http';
import { cashfreeRefundId } from './cashfree';
import { anyRefundGateway, providerByName, refundGatewayFor } from './payment-provider';
import { razorpay } from './razorpay';
import type { PaymentProviderName } from './store';

type Row = Record<string, any>;
export type RefundOutcome = 'refunded' | 'in_flight' | 'due' | 'nothing_to_refund' | 'not_needed';

const paise = (rupees: number) => Math.round(rupees * 100);
const rupees = (n: number) => Math.round(n * 100) / 100;

// Where an order's money was taken: the provider, its payment id and (Cashfree) the order the payment was made on.
type PaidWith = { provider: PaymentProviderName; paymentId: string | null; providerOrderId: string | null; paidMinor: number; checkoutId: string | null };
async function paidWith(order: Row): Promise<PaidWith> {
  let checkout: Row | null = null;
  if (order.checkout_id) {
    const { data } = await db().from('ol_checkouts').select('id, total, payment_provider, provider_order_id, cf_payment_id, razorpay_payment_id').eq('id', order.checkout_id).maybeSingle();
    checkout = data as Row | null;
  }
  const provider: PaymentProviderName = checkout?.payment_provider === 'cashfree' ? 'cashfree' : 'razorpay';
  const paymentId = provider === 'cashfree' ? (checkout?.cf_payment_id as string | null) ?? null : (order.razorpay_payment_id as string | null) ?? (checkout?.razorpay_payment_id as string | null) ?? null;
  return { provider, paymentId, providerOrderId: (checkout?.provider_order_id as string | null) ?? null, paidMinor: checkout ? paise(Number(checkout.total)) : paise(Number(order.total)), checkoutId: checkout?.id ?? null };
}

// Money already issued or on its way back for one checkout (all its store orders): processed, accepted by the gateway, or approved.
// A refund still "requested" or "failed" has not left yet, so it is not counted: the cap guards what has actually been sent.
async function issuedMinor(checkoutId: string, exceptRefund?: string): Promise<number> {
  const { data: orders } = await db().from('ol_orders').select('id').eq('checkout_id', checkoutId);
  const ids = (orders ?? []).map((o: Row) => o.id as string);
  if (!ids.length) return 0;
  const { data, error } = await db().from('ol_refunds').select('id, amount').in('order_id', ids).in('status', ['processed', 'gateway_pending', 'approved']);
  if (error) fromDbError(error);
  return (data ?? []).filter((r: Row) => r.id !== exceptRefund).reduce((n: number, r: Row) => n + paise(Number(r.amount)), 0);
}

// What has already been refunded (or is on its way: Razorpay accepted it but has not settled it) for one order. A refund in the queue
// (requested / gateway_pending / failed: the worker below or operations own it) counts too, so this direct path never refunds the same money a second time.
async function refundedSoFar(orderId: string): Promise<number> {
  const { data, error } = await db().from('ol_refunds').select('amount').eq('order_id', orderId).in('status', ['processed', 'approved', 'requested', 'gateway_pending', 'failed']);
  if (error) fromDbError(error);
  return rupees((data ?? []).reduce((n: number, r: Row) => n + Number(r.amount), 0));
}

// An order whose processed refunds cover its total is "refunded"; a checkout whose orders all are, is too.
async function markRefundedIfCovered(order: Row) {
  const { data } = await db().from('ol_refunds').select('amount').eq('order_id', order.id).eq('status', 'processed');
  const processed = (data ?? []).reduce((n: number, r: Row) => n + Number(r.amount), 0);
  if (processed + 0.004 < Number(order.total)) return;
  await db().from('ol_orders').update({ payment_status: 'refunded' }).eq('id', order.id);
  if (!order.checkout_id) return;
  const { data: siblings } = await db().from('ol_orders').select('payment_status').eq('checkout_id', order.checkout_id);
  if ((siblings ?? []).every((s: Row) => s.payment_status === 'refunded')) await db().from('ol_checkouts').update({ payment_status: 'refunded' }).eq('id', order.checkout_id);
}

// Refunds what is still owed on one order of an online payment, and books it. Never throws: a refund that cannot be made now is
// reported as 'due' and retried by the sweep.
// `flip` = also mark the order (and its checkout) "refunded" once its refunds cover it. Not wanted when the order is still going ahead as
// a cash order (a late payment returned after the customer switched to cash): it stays a cash order, only the ledger records the refund.
export async function refundOrderShare(order: Row, paymentId: string, reason: string, flip = true, via?: { provider: 'cashfree'; providerOrderId: string; paidMinor: number; paymentId?: string | null }): Promise<RefundOutcome> {
  const owed = rupees(Number(order.total) - (await refundedSoFar(order.id)));
  if (owed <= 0.004) return 'nothing_to_refund';
  if (via?.provider === 'cashfree') return refundOrderShareCashfree(order, owed, reason, flip, via);
  try {
    // The idempotency header makes a retry (the call worked but booking it failed) return the same refund, not make another.
    const made = await razorpay<{ id: string; status?: string }>(`/payments/${encodeURIComponent(paymentId)}/refund`,
      { amount: paise(owed), speed: 'normal', notes: { order_id: String(order.id), reason: reason.slice(0, 100) } },
      { 'X-Refund-Idempotency': `ol-refund-${order.id}-${paise(Number(order.total) - owed)}` });
    const processed = made.status === 'processed';
    const now = new Date().toISOString();
    const { error } = await db().from('ol_refunds').insert({
      order_id: order.id, amount: owed, reason: reason.slice(0, 480).padEnd(3, '.'), method: 'original', status: processed ? 'processed' : 'approved',
      reference: made.id, created_at: now, processed_at: processed ? now : null,
    });
    if (error && error.code !== '23505') fromDbError(error); // 23505: the refund.processed webhook booked it first
    if (processed && flip) await markRefundedIfCovered(order);
    return processed ? 'refunded' : 'in_flight';
  } catch (error) {
    console.error('[refunds] refund for order', order.id, 'could not be made now; it stays due and the sweep will retry:', error instanceof HttpError ? error.detail : (error as Error)?.message);
    return 'due';
  }
}

// A refund the direct path (above) makes at Cashfree. The gateway call comes first and is booked after, like the Razorpay path: the
// refund id is the same for the same order and the same amount already refunded (spec: ol-refund-<order>-<cumulative paise>, hashed to
// Cashfree's 40-character limit), so a retry after a lost reply returns the same Cashfree refund, never a second one.
async function refundOrderShareCashfree(order: Row, owed: number, reason: string, flip: boolean, via: { providerOrderId: string; paidMinor: number }): Promise<RefundOutcome> {
  const gateway = refundGatewayFor('cashfree');
  if (!gateway || !via.providerOrderId) { console.error('[refunds] order', order.id, 'was paid with Cashfree but there is no gateway or Cashfree order on file: refund it by hand'); return 'due'; }
  const owedMinor = paise(owed), alreadyMinor = paise(Number(order.total) - owed);
  // Never more than was paid: the cap is cumulative over every store order of the checkout, not just this one.
  if (order.checkout_id && (await issuedMinor(order.checkout_id)) + owedMinor > via.paidMinor) {
    console.error('[refunds] refusing to refund order', order.id, ': it would exceed the amount paid for its checkout');
    return 'due';
  }
  const refundId = await cashfreeRefundId('order', String(order.id), alreadyMinor);
  try {
    const made = await gateway.createRefund({
      paymentId: '', amountMinor: owedMinor, idempotencyKey: refundId, notes: { order_id: String(order.id), reason: reason.slice(0, 100) },
      providerOrderId: via.providerOrderId, refundId, speed: 'STANDARD',
    });
    const status = String(made.status ?? 'PENDING').toUpperCase();
    const now = new Date().toISOString();
    if (status === 'CANCELLED' || status === 'REJECTED') throw new HttpError(502, `Cashfree reported the refund ${status}`);
    const processed = status === 'SUCCESS';
    const { error } = await db().from('ol_refunds').insert({
      order_id: order.id, amount: owed, reason: reason.slice(0, 480).padEnd(3, '.'), method: 'original', status: processed ? 'processed' : 'gateway_pending',
      reference: refundId, provider: 'cashfree', provider_refund_id: made.providerRefundId ?? null, provider_status: status, refund_speed: 'STANDARD',
      created_at: now, processed_at: processed ? now : null,
    });
    if (error && error.code !== '23505') fromDbError(error); // 23505: the REFUND_STATUS webhook (or an earlier try) booked it first
    if (processed && flip) await markRefundedIfCovered(order);
    return processed ? 'refunded' : 'in_flight';
  } catch (error) {
    const rejected = error instanceof HttpError && error.code === 'refund_failed';
    console.error('[refunds] refund for order', order.id, rejected ? 'was refused by Cashfree; it goes to the retry queue:' : 'could not be made now; it stays due and the sweep will retry:', error instanceof HttpError ? error.detail : (error as Error)?.message);
    if (rejected || (error instanceof HttpError && /reported the refund/.test(error.detail))) {
      // Cashfree said no: hand the refund to the queue so it is retried with backoff (under a new refund id), shown to operations, and not hammered every sweep.
      const { error: queued } = await db().from('ol_refunds').insert({
        order_id: order.id, amount: owed, reason: reason.slice(0, 480).padEnd(3, '.'), method: 'original', status: 'requested', idempotency_key: `direct:${refundId}`,
        last_error: String(error instanceof HttpError ? error.detail : '').slice(0, 280) || null, provider: 'cashfree',
      });
      if (queued && queued.code !== '23505') console.error('[refunds] could not queue the refund for order', order.id, queued.message);
      else return 'in_flight';
    }
    return 'due';
  }
}

// The payment an order was paid with. Razorpay: on the order itself, else on its checkout.
async function paymentIdOf(order: Row): Promise<string | null> {
  if (order.razorpay_payment_id) return String(order.razorpay_payment_id);
  if (!order.checkout_id) return null;
  const { data } = await db().from('ol_checkouts').select('razorpay_payment_id').eq('id', order.checkout_id).maybeSingle();
  return (data?.razorpay_payment_id as string | null) ?? null;
}

const ORDER_FIELDS = 'id, total, checkout_id, payment_method, payment_status, razorpay_payment_id';

// Refund an order that was cancelled before any restaurant saw it and had been paid online.
async function refundCancelled(order: Row): Promise<RefundOutcome> {
  const paid = await paidWith(order);
  if (paid.provider === 'cashfree') {
    if (!paid.providerOrderId) { console.error('[refunds] order', order.id, 'was paid with Cashfree but has no Cashfree order on file: refund it by hand'); return 'due'; }
    return refundOrderShare(order, paid.paymentId ?? '', 'Order could not be fulfilled', true, { provider: 'cashfree', providerOrderId: paid.providerOrderId, paidMinor: paid.paidMinor, paymentId: paid.paymentId });
  }
  const paymentId = await paymentIdOf(order);
  if (!paymentId) { console.error('[refunds] order', order.id, 'was paid online but has no payment id on file: refund it by hand'); return 'due'; }
  return refundOrderShare(order, paymentId, 'Order could not be fulfilled');
}

// An order that cannot be handed to a restaurant: cancel it (only while it is still "placed" and unadopted, so a restaurant that
// already has it is never overridden) and, if the customer paid online, refund it. Returns what happened.
export async function cancelUnfulfillable(olOrderId: string, reason: string): Promise<{ cancelled: boolean; refund: RefundOutcome }> {
  // The lifecycle function moves the state (guarded by the 0219 trigger, which also fans the cancel out to the delivery job and the refund queue).
  // Only an order still "placed" and not yet adopted by a restaurant may be cancelled here: checked first, and order_transition itself refuses
  // anything but placed (OL_WRONG_STATE). Note: order_transition has no "unadopted only" rule, so an adoption landing between the check and the
  // call is cancelled through the cascade rather than refused (db-requests: add p_meta.require_unadopted if that matters).
  const { data: current, error: readError } = await db().from('ol_orders').select(`${ORDER_FIELDS}, status, pos_order_id`).eq('id', olOrderId).maybeSingle<Row>();
  if (readError) fromDbError(readError);
  if (!current || current.status !== 'placed' || current.pos_order_id) return { cancelled: false, refund: 'not_needed' };
  // No key: a repeat finds the order already cancelled and is a no-op inside the function.
  const { error } = await db().rpc('order_transition', { p_order: olOrderId, p_event: 'ops_cancel', p_actor: 'system', p_idempotency_key: null, p_meta: { cancel_reason: reason.slice(0, 200) } });
  if (error) {
    if (/^OL_WRONG_STATE/.test(error.message ?? '')) return { cancelled: false, refund: 'not_needed' };
    fromDbError(error);
  }
  const order = current;
  console.warn('[orders] order', olOrderId, 'cannot be fulfilled and was cancelled:', reason);
  if (order.payment_method === 'cod' || order.payment_status !== 'paid') return { cancelled: true, refund: 'not_needed' };
  return { cancelled: true, refund: await refundCancelled(order) };
}

// The queue: cancelled, never adopted, paid online, not (fully) refunded. Run by the dispatch sweep.
export async function refundDue(limit = 50): Promise<{ checked: number; refunded: number; due: number }> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data, error } = await db().from('ol_orders').select(ORDER_FIELDS).eq('status', 'cancelled').eq('payment_status', 'paid')
    .neq('payment_method', 'cod').is('pos_order_id', null).gte('created_at', since).limit(limit);
  if (error) fromDbError(error);
  const out = { checked: data?.length ?? 0, refunded: 0, due: 0 };
  for (const order of data ?? []) {
    const r = await refundCancelled(order);
    if (r === 'refunded' || r === 'in_flight' || r === 'nothing_to_refund') out.refunded++; else out.due++;
  }
  return out;
}

// A payment that arrives for a checkout the customer already switched to cash (SRV-3): the cash job is with a rider, so the
// online money is returned in full, one refund per store order so each lands on the right order.
export async function refundLateCapture(checkoutId: string, paymentId: string, cashfree?: { providerOrderId: string; paidMinor: number }): Promise<RefundOutcome[]> {
  const { data, error } = await db().from('ol_orders').select(ORDER_FIELDS).eq('checkout_id', checkoutId).order('created_at');
  if (error) fromDbError(error);
  const results: RefundOutcome[] = [];
  const via = cashfree ? { provider: 'cashfree' as const, providerOrderId: cashfree.providerOrderId, paidMinor: cashfree.paidMinor, paymentId } : undefined;
  for (const order of data ?? []) results.push(await refundOrderShare(order, paymentId, 'Paid online after choosing pay on delivery', false, via));
  await db().from('ol_checkouts').update({ payment_error: 'An online payment made after switching to pay on delivery was refunded' }).eq('id', checkoutId).eq('payment_status', 'not_charged');
  return results;
}

// ---------- The refund worker ----------
// Drains the database refund queue (0218 ol_refund_claim -> gateway -> ol_refund_complete / ol_refund_fail), run by the dispatch sweep.
//  - Only claims when a gateway exists (keys on, or a fake injected in tests): without one nothing is claimed and no attempt is burned.
//  - The gateway idempotency key is stable per refund (ol-refund-q-<refund id>): a retry after a crash or a lost reply returns the SAME Razorpay
//    refund, so one queued refund can never become two. A refund the database already holds as processed is never claimed again.
//  - A failure goes back through ol_refund_fail; ol_refund_requeue_failed (0235) retries it after 60s, 120s, 240s... and after MAX attempts leaves
//    it failed and opens an exception for operations (payment_reconciliation_exceptions, kind cancelled_not_refunded).
//  - If the gateway accepted the refund but booking it failed, the claim times out (ops_sweep, 15 min), is requeued and the same key returns the same id.
export const REFUND_MAX_ATTEMPTS = 5;
export const REFUND_BACKOFF_SECONDS = 60;
//  - Cashfree refunds (0238): the refund goes to the checkout's Cashfree order with our deterministic refund id, never beyond the amount paid.
//    Cashfree normally answers PENDING: the refund then stays gateway_pending (no longer a worker claim) until the REFUND_STATUS webhook or
//    the poll below says SUCCESS (processed), or CANCELLED / REJECTED (failed, retried by the queue under a NEW refund id).
export type RefundWorkerResult = { skipped?: 'no_gateway'; requeued: number; exhausted: number; claimed: number; completed: number; failed: number; in_flight?: number };

export async function completeQueuedRefunds(limit = 20): Promise<RefundWorkerResult> {
  const out: RefundWorkerResult = { requeued: 0, exhausted: 0, claimed: 0, completed: 0, failed: 0, in_flight: 0 };
  if (!anyRefundGateway()) return { ...out, skipped: 'no_gateway' };
  const { data: requeue, error: requeueError } = await db().rpc('ol_refund_requeue_failed', { p_max_attempts: REFUND_MAX_ATTEMPTS, p_base_seconds: REFUND_BACKOFF_SECONDS });
  if (requeueError) fromDbError(requeueError);
  out.requeued = Number((requeue as Row)?.requeued ?? 0);
  out.exhausted = Number((requeue as Row)?.exhausted ?? 0);
  const { data: claimed, error: claimError } = await db().rpc('ol_refund_claim', { p_limit: limit });
  if (claimError) fromDbError(claimError);
  for (const c of (claimed ?? []) as Row[]) {
    out.claimed++;
    const refundId = String(c.refund_id);
    try {
      const { data: order } = await db().from('ol_orders').select(ORDER_FIELDS).eq('id', c.order_id).maybeSingle();
      const paid = await paidWith((order as Row | null) ?? { id: c.order_id, total: Number(c.amount), checkout_id: null });
      const gateway = refundGatewayFor(paid.provider);
      if (!gateway) throw new Error(`no ${paid.provider} refund gateway is set up: refund it by hand`);
      if (paid.provider === 'cashfree') {
        if (!paid.providerOrderId) throw new Error('no Cashfree order on file for this refund: refund it by hand');
        // Over-refund guard: what already went back for the whole checkout plus this refund must stay within what was paid.
        if (paid.checkoutId && (await issuedMinor(paid.checkoutId, refundId)) + Number(c.amount_minor) > paid.paidMinor) throw new Error('this refund would exceed the amount paid: check it with the payment team');
        const { data: row } = await db().from('ol_refunds').select('provider_attempt').eq('id', refundId).maybeSingle();
        // Same id on every retry of the same refund (a lost reply must not become a second refund); a NEW id only after Cashfree itself
        // reported the refund failed (provider_attempt, bumped by ol_refund_provider_update).
        const gatewayRefundId = await cashfreeRefundId('queue', refundId, Number(row?.provider_attempt ?? 0));
        const made = await gateway.createRefund({
          paymentId: paid.paymentId ?? '', amountMinor: Number(c.amount_minor), idempotencyKey: gatewayRefundId,
          notes: { order_id: String(c.order_id), refund_id: refundId, reason: String(c.reason ?? '').slice(0, 100) },
          providerOrderId: paid.providerOrderId, refundId: gatewayRefundId, speed: 'STANDARD',
        });
        const { data: updated, error } = await db().rpc('ol_refund_provider_update', {
          p_refund: refundId, p_provider: 'cashfree', p_merchant_ref: gatewayRefundId, p_provider_refund_id: made.providerRefundId ?? null,
          p_provider_status: String(made.status ?? 'PENDING'), p_source: 'worker', p_detail: null,
        });
        if (error) fromDbError(error);
        const status = (updated as Row)?.status;
        if (status === 'processed') out.completed++; else if (status === 'failed') out.failed++; else out.in_flight = (out.in_flight ?? 0) + 1;
        continue;
      }
      if (!c.payment_reference) throw new Error('no payment id on file for this order: refund it by hand');
      const made = await gateway.createRefund({
        paymentId: String(c.payment_reference), amountMinor: Number(c.amount_minor), idempotencyKey: `ol-refund-q-${refundId}`,
        notes: { order_id: String(c.order_id), refund_id: refundId, reason: String(c.reason ?? '').slice(0, 100) },
      });
      if (!made?.id) throw new Error('the gateway answered without a refund id');
      const { error } = await db().rpc('ol_refund_complete', { p_refund: refundId, p_gateway_reference: made.id });
      if (error) fromDbError(error);
      out.completed++;
    } catch (error) {
      out.failed++;
      const message = error instanceof HttpError ? error.detail ?? error.message : (error as Error)?.message ?? 'gateway error';
      console.error('[refunds] queued refund', refundId, 'failed; the worker retries it with backoff:', String(message).slice(0, 160));
      try { await db().rpc('ol_refund_fail', { p_refund: refundId, p_error: String(message).slice(0, 280) }); } catch { /* left gateway_pending: the sweep requeues it after its timeout */ }
    }
  }
  return out;
}

// Cashfree refunds the gateway has accepted but not settled: ask Cashfree where each one is (the REFUND_STATUS webhook is the fast path, this is the
// safety net for a webhook that never arrived, e.g. on a laptop). Run by the dispatch sweep. Each answer goes through ol_refund_provider_update.
export async function pollGatewayRefunds(limit = 25): Promise<{ checked: number; processed: number; failed: number }> {
  const out = { checked: 0, processed: 0, failed: 0 };
  const provider = providerByName('cashfree');
  if (!provider) return out;
  const { data, error } = await db().from('ol_refunds').select('id, order_id, reference, provider_refund_id, created_at')
    .eq('provider', 'cashfree').eq('status', 'gateway_pending').lt('created_at', new Date(Date.now() - 2 * 60_000).toISOString()).order('created_at').limit(limit);
  if (error) fromDbError(error);
  for (const r of (data ?? []) as Row[]) {
    try {
      const { data: order } = await db().from('ol_orders').select(ORDER_FIELDS).eq('id', r.order_id).maybeSingle();
      const paid = await paidWith((order as Row | null) ?? { id: r.order_id, total: 0, checkout_id: null });
      if (!paid.providerOrderId || !r.reference) continue;
      out.checked++;
      const now = await provider.fetchRefund({ providerOrderId: paid.providerOrderId, paymentId: null, refundId: String(r.reference), providerRefundId: r.provider_refund_id });
      const { data: updated, error: updateError } = await db().rpc('ol_refund_provider_update', {
        p_refund: r.id, p_provider: 'cashfree', p_merchant_ref: String(r.reference), p_provider_refund_id: now.providerRefundId, p_provider_status: now.rawStatus || 'PENDING', p_source: 'poll', p_detail: now.description,
      });
      if (updateError) fromDbError(updateError);
      if ((updated as Row)?.status === 'processed') out.processed++; else if ((updated as Row)?.status === 'failed') out.failed++;
    } catch (e) {
      console.error('[refunds] could not poll refund', r.id, e instanceof HttpError ? e.detail : (e as Error)?.message);
    }
  }
  return out;
}
