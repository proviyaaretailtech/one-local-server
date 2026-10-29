// A customer cancelling their own order, and the "what happens if I cancel" preview that comes before it.
// The database owns the rules: ol_customer_cancel (migration 0219) checks ownership, decides the stage, writes the
// cancellation, and the cancel cascade queues the refund (order_compensate, 0218). This file only checks who is asking,
// limits how often, and reports the result. It never takes an amount, a percentage or a stage from the client.
// The preview mirrors the same rule (cancellation_policy: the business's own row, else the platform default, else 0%) so the
// app can show the fee before the customer confirms. Only ol_customer_cancel's answer is the truth.
import { caller } from './auth';
import { db, dbConfigured, fromDbError } from './db';
import { HttpError } from './http';
import { idempotencyKey, runIdempotent } from './idempotency';
import { limitCaller } from './limits';

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const r2 = (n: number) => Math.round(n * 100) / 100;
const notFound = () => new HttpError(404, 'Order not found', undefined, 'not_found');

export type CancelStage = 'before_accept' | 'after_accept' | 'packed';
export type CancelPreview = {
  order_id: string; status: string; can_cancel: boolean; blocked_reason: 'already_cancelled' | 'too_late' | null;
  stage: CancelStage | null; refund_pct: number; paid_online: boolean; paid_amount: number; refund_amount: number; fee_amount: number; currency: 'INR';
};

// The order, only if it belongs to this caller (same ownership rule as getOrder: customer_hash among the caller's hashes).
export async function ownOrder(request: Request, id: string): Promise<Row> {
  if (!dbConfigured()) throw new HttpError(503, 'The database is not connected yet.', undefined, 'database_unavailable');
  const { matches } = await caller(request);
  if (!matches.length || !UUID.test(id)) throw notFound();
  const { data, error } = await db().from('ol_orders').select('id, status, organization_id, customer_hash, total, payment_method, payment_status').eq('id', id).in('customer_hash', matches).maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw notFound();
  return data;
}

// Mirrors ol_customer_cancel's "already on its way" test: status out/delivered, or a delivery job that has been picked up.
async function onItsWay(order: Row): Promise<boolean> {
  if (['out', 'delivered'].includes(order.status)) return true;
  const { data, error } = await db().from('delivery_jobs').select('status, picked_up_at, exception_from_status').eq('ol_order_id', order.id);
  if (error) fromDbError(error);
  return (data ?? []).some((j: Row) => j.picked_up_at != null || ['picked_up', 'at_drop', 'delivered'].includes(j.status) || ['picked_up', 'at_drop'].includes(j.exception_from_status));
}

async function refundPct(order: Row, stage: CancelStage): Promise<number> {
  const { data, error } = await db().from('cancellation_policy').select('organization_id, refund_pct').eq('stage', stage);
  if (error) fromDbError(error);
  const rows = (data ?? []) as Row[];
  const own = rows.find(r => r.organization_id && r.organization_id === order.organization_id) ?? rows.find(r => r.organization_id == null);
  return own ? Number(own.refund_pct) : 0;
}

// What the database has actually captured for the order (online payments only); 0 for cash.
async function captured(orderId: string): Promise<number> {
  const { data, error } = await db().rpc('ol_order_captured', { p_ol: orderId });
  if (error) fromDbError(error);
  return r2(Number(data ?? 0));
}

async function preview(order: Row): Promise<CancelPreview> {
  const base = { order_id: order.id as string, status: order.status as string, currency: 'INR' as const };
  const paidOnline = order.payment_method !== 'cod' && order.payment_status === 'paid';
  if (order.status === 'cancelled') return { ...base, can_cancel: false, blocked_reason: 'already_cancelled', stage: null, refund_pct: 0, paid_online: paidOnline, paid_amount: 0, refund_amount: 0, fee_amount: 0 };
  if (await onItsWay(order)) return { ...base, can_cancel: false, blocked_reason: 'too_late', stage: null, refund_pct: 0, paid_online: paidOnline, paid_amount: 0, refund_amount: 0, fee_amount: 0 };
  const stage: CancelStage = order.status === 'placed' ? 'before_accept' : order.status === 'accepted' ? 'after_accept' : 'packed';
  const pct = await refundPct(order, stage);
  const paid = paidOnline ? await captured(order.id) : 0;
  const refund = r2(paid * pct / 100);
  return { ...base, can_cancel: true, blocked_reason: null, stage, refund_pct: pct, paid_online: paidOnline, paid_amount: paid, refund_amount: refund, fee_amount: r2(paid - refund) };
}

// GET /orders/:id/cancel
export async function cancelPreview(request: Request, id: string): Promise<CancelPreview> {
  await limitCaller(request, 'order-cancel-preview', 60, 60_000);
  return preview(await ownOrder(request, id));
}

// POST /orders/:id/cancel   body: { reason }   header (optional): Idempotency-Key
// Safe to repeat: a second call on an order that is already cancelled answers with replayed = true and the same refund.
export async function cancelOrder(request: Request, id: string, body: Record<string, unknown>) {
  await limitCaller(request, 'order-cancel', 10, 60_000);
  const key = idempotencyKey(request) ?? '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  const order = await ownOrder(request, id);
  // With a key: the shared helper (idempotency_begin/complete) scoped by this customer replays the first answer; the database's own
  // replay in ol_customer_cancel still covers a repeat without a key.
  const out = await runIdempotent(`cancel:${order.customer_hash}`, key || null, `POST /orders/${order.id}/cancel\n${reason}`, async () => ({ body: await doCancel(order, reason, key) }));
  return out.body as Awaited<ReturnType<typeof doCancel>>;
}

async function doCancel(order: Row, reason: string, key: string) {
  const { data, error } = await db().rpc('ol_customer_cancel', { p_order: order.id, p_customer: order.customer_hash, p_reason: reason });
  if (error) {
    // Raced with the rider's pickup after the preview: tell the app with a code it can word, not a bare 400.
    if (/^OL_TOO_LATE/.test(error.message ?? '')) throw new HttpError(409, 'The order is already on its way and can no longer be cancelled.', undefined, 'too_late');
    fromDbError(error);
  }
  const result = (data ?? {}) as Row;
  let refund: Row | null = null;
  if (result.refund_id) {
    const { data: r, error: e } = await db().from('ol_refunds').select('id, amount, status, method').eq('id', result.refund_id).maybeSingle();
    if (e) fromDbError(e);
    refund = r ? { id: r.id, amount: Number(r.amount), status: r.status, method: r.method } : null;
  }
  return {
    order_id: order.id as string, status: 'cancelled' as const, replayed: result.replayed === true, idempotency_key: key || null,
    stage: (result.stage ?? null) as CancelStage | null, refund_pct: result.refund_pct != null ? Number(result.refund_pct) : null,
    refund, // null when nothing was paid online (cash order) or the cancel terms refund nothing
  };
}
