// Outbox publisher: delivers domain_events (migrations 0123 / 0221) to the consumers that exist today, then marks them published.
// Run by the dispatch sweep (POST /api/dispatch/sweep), so the same scheduler drives it. events_claim leases rows for 2 minutes, so two
// sweeps never take the same event; an event whose delivery threw is left unpublished and comes back after the lease (and shows in the alarm).
// Today's consumers: order.transitioned -> customer / restaurant / rider push for accepted, rejected, cancelled, picked_up, delivered.
// Every other event type has no consumer yet: it is marked published so it does not raise the stuck-events alarm.
import { db, dbConfigured, fromDbError } from './db';
import { pushToCustomer, pushToRestaurant, pushToRider } from './push';

type Row = Record<string, any>;
export type OrderEventKind = 'accepted' | 'rejected' | 'cancelled' | 'picked_up' | 'delivered';

// What the customer-visible meaning of an order.transitioned event is (null = not worth a push).
export function eventKind(payload: Row): OrderEventKind | null {
  const ev = String(payload?.event ?? ''), to = String(payload?.to ?? '');
  if (ev === 'restaurant_accept') return 'accepted';
  if (ev === 'restaurant_reject') return 'rejected';
  if (to === 'cancelled' && payload?.from !== 'cancelled') return 'cancelled';
  if (to === 'out' && ev !== 'kitchen_ready') return 'picked_up';
  if (to === 'delivered') return 'delivered';
  return null;
}

const TEXT: Record<OrderEventKind, { title: string; body: string }> = {
  accepted: { title: 'Order accepted', body: 'The restaurant is preparing your order.' },
  rejected: { title: 'Order declined', body: 'The restaurant could not take your order. Any online payment is refunded.' },
  cancelled: { title: 'Order cancelled', body: 'Your order was cancelled.' },
  picked_up: { title: 'On its way', body: 'Your order has been picked up.' },
  delivered: { title: 'Delivered', body: 'Your order was delivered. Enjoy!' },
};

async function deliverOrderEvent(e: Row, counts: { push_customer: number; push_partner: number; push_rider: number; skipped: number }) {
  const kind = eventKind(e.payload ?? {});
  if (!kind) { counts.skipped++; return; }
  const { data: order, error } = await db().from('ol_orders').select('id, user_id, organization_id').eq('id', e.aggregate_id).maybeSingle();
  if (error) fromDbError(error);
  if (!order) { counts.skipped++; return; }
  const data = { type: `order_${kind}`, order_id: order.id };
  const msg = TEXT[kind];
  if ((await pushToCustomer(order.user_id as string | null, { ...msg, data })).sent) counts.push_customer++;
  // The restaurant knows what it did itself (accept/reject); it hears about the other side's moves.
  if (['cancelled', 'picked_up', 'delivered'].includes(kind) && order.organization_id) {
    if ((await pushToRestaurant(order.organization_id as string, { ...msg, data })).sent) counts.push_partner++;
  }
  if (kind === 'cancelled') {
    const { data: job } = await db().from('delivery_jobs').select('id, rider_id').eq('ol_order_id', order.id).not('rider_id', 'is', null).maybeSingle();
    if (job?.rider_id && (await pushToRider(job.rider_id as string, { title: 'Order cancelled', body: 'This delivery was cancelled.', data: { type: 'job_cancelled', job_id: job.id }, sound: false })).sent) counts.push_rider++;
  }
}

export async function publishOutbox(limit = 100) {
  const out = { claimed: 0, published: 0, failed: 0, push_customer: 0, push_partner: 0, push_rider: 0, skipped: 0 };
  const { data, error } = await db().rpc('events_claim', { p_limit: limit });
  if (error) fromDbError(error);
  const events = (data ?? []) as Row[];
  out.claimed = events.length;
  const done: number[] = [];
  for (const e of events) {
    try {
      if (e.event_type === 'order.transitioned') await deliverOrderEvent(e, out);
      done.push(e.id);
    } catch (err) {
      out.failed++;
      console.error('[outbox] delivery failed; it will be retried after the lease', e.event_type, e.id, (err as Error)?.message?.slice(0, 120));
    }
  }
  if (done.length) {
    const { data: n, error: markError } = await db().rpc('events_mark_published', { p_ids: done });
    if (markError) fromDbError(markError);
    out.published = Number(n ?? 0);
  }
  return out;
}

// For /api/health: how many events are stuck, nothing else (no payloads, no ids).
export async function outboxStuckCount(minutes = 5): Promise<number | null> {
  try {
    if (!dbConfigured()) return null;
    const { data, error } = await db().rpc('events_outbox_alarm', { p_minutes: minutes });
    if (error) return null;
    return Number((data as Row)?.stuck_events ?? 0);
  } catch { return null; }
}
