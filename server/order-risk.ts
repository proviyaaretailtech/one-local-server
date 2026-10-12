// Order risk: what an honest basket looks like, and what to do with one that does not (founder, 10 Oct 2026: "I ordered 43
// burgers, but I might be a rogue"). The server cannot know whether a request is genuine, so it answers in three steps:
//   1. Rate limits (store.ts limitOrders, limits.ts): how often one account, device or network address may order.
//   2. Hard caps (checked when the cart is priced, pricing.ts): a basket over them is refused outright.
//   3. Holds (here): a basket that is possible but unusual is accepted, and held for a person to check before any
//      restaurant sees it. The database enforces the hold (0331: ol_adopt_marketplace_order refuses a held order),
//      so every path that sends an order to a restaurant respects it.
// The numbers are a starting point for the pilot; operations should tune them (open question for the founder).
import { db } from './db';
import { HttpError } from './http';
import type { Order } from './store';
import { adoptOrders, dispatchOrders } from './dispatch';
import { cancelUnfulfillable } from './refunds';

export const ORDER_CAPS = {
  lineQty: { food: 20, other: 25 },   // most of ONE item in one order
  basketQty: 60,                       // most items in one checkout
} as const;

export const HOLD_RULES = {
  lineQty: { food: 8, other: 12 },     // more of one item than a family orders
  cashTotal: 5000,                     // ₹, a cash order this large waits
  firstCashTotal: 2000,                // ₹, a first-ever cash order this large waits
  ordersPerHour: 3,                    // this customer already placed this many checkouts in the last hour
} as const;

type Line = { name: string; qty: number; department?: string };

// Hard caps: called while pricing, so the cart screen shows the message before checkout.
export function assertWithinCaps(lines: Line[]) {
  for (const l of lines) {
    const max = l.department === 'food' ? ORDER_CAPS.lineQty.food : ORDER_CAPS.lineQty.other;
    if (l.qty > max) throw new HttpError(400, `You can order up to ${max} of “${l.name}” at a time. For a bigger order, please contact support.`);
  }
  const total = lines.reduce((s, l) => s + l.qty, 0);
  if (total > ORDER_CAPS.basketQty) throw new HttpError(400, `One order can hold up to ${ORDER_CAPS.basketQty} items. Please split it, or contact support for a bulk order.`);
}

export type HoldReason =
  | { code: 'line_qty'; item: string; qty: number; limit: number }
  | { code: 'cash_total'; total: number; limit: number }
  | { code: 'first_cash_total'; total: number; limit: number }
  | { code: 'orders_per_hour'; recent: number; limit: number };

// Why this checkout should wait for a person, or [] when it can go straight to the restaurant.
// `kind` is the checkout's cart: a food checkout is one restaurant's dishes, a shopping one everything else.
export async function holdReasons(input: { kind: 'food' | 'shopping'; customerHash: string; userId: string | null; checkoutId: string; paymentMethod: string; total: number; orders: Order[] }): Promise<HoldReason[]> {
  const reasons: HoldReason[] = [];
  const limit = input.kind === 'food' ? HOLD_RULES.lineQty.food : HOLD_RULES.lineQty.other;
  for (const o of input.orders) for (const l of o.items) {
    if (l.qty > limit) reasons.push({ code: 'line_qty', item: l.name, qty: l.qty, limit });
  }
  const cash = input.paymentMethod === 'cod';
  if (cash && input.total > HOLD_RULES.cashTotal) reasons.push({ code: 'cash_total', total: input.total, limit: HOLD_RULES.cashTotal });

  // History: by account when signed in, else by device. Orders of this checkout are excluded.
  const mine = () => {
    const q = db().from('ol_checkouts').select('id', { count: 'exact', head: true }).neq('id', input.checkoutId);
    return input.userId ? q.eq('user_id', input.userId) : q.eq('customer_hash', input.customerHash);
  };
  if (cash && input.total > HOLD_RULES.firstCashTotal) {
    const { count, error } = await mine();
    if (!error && (count ?? 0) === 0) reasons.push({ code: 'first_cash_total', total: input.total, limit: HOLD_RULES.firstCashTotal });
  }
  const { count: recent, error } = await mine().gte('created_at', new Date(Date.now() - 3_600_000).toISOString());
  if (!error && (recent ?? 0) >= HOLD_RULES.ordersPerHour) reasons.push({ code: 'orders_per_hour', recent: recent ?? 0, limit: HOLD_RULES.ordersPerHour });
  return reasons;
}

// Records the hold for every store order in the checkout. If the record cannot be written the order is NOT sent on: the caller
// treats a throw as "held", and the dispatch sweep only adopts once the row exists or it is released (never silently skipped).
export async function holdCheckout(checkoutId: string, orderIds: string[], reasons: HoldReason[]) {
  const { error } = await db().from('ol_order_holds').insert(orderIds.map(order_id => ({ order_id, checkout_id: checkoutId, reasons })));
  if (error) throw new HttpError(500, 'Your order could not be confirmed. Please try again.');
  console.warn('[order-risk] checkout', checkoutId, 'held for review:', reasons.map(r => r.code).join(','));
}

export type HeldOrder = { id: string; order_id: string; checkout_id: string | null; reasons: HoldReason[]; created_at: string };
export async function openHolds(): Promise<HeldOrder[]> {
  const { data, error } = await db().from('ol_order_holds').select('id, order_id, checkout_id, reasons, created_at').eq('status', 'held').order('created_at').limit(200);
  if (error) throw new HttpError(500, 'Holds could not be loaded.');
  return (data ?? []) as HeldOrder[];
}

// Operations' decision. Release sends the order to its restaurant now; reject cancels it (and refunds it if it was paid).
export async function decideHold(holdId: string, decision: 'release' | 'reject', adminId: string, note: string | null) {
  const status = decision === 'release' ? 'released' : 'rejected';
  const { data, error } = await db().from('ol_order_holds').update({ status, decided_at: new Date().toISOString(), decided_by: adminId, note })
    .eq('id', holdId).eq('status', 'held').select('order_id').maybeSingle();
  if (error) throw new HttpError(409, 'This hold was already decided.');
  if (!data) throw new HttpError(404, 'No open hold with that id.');
  const orderId = data.order_id as string;
  if (decision === 'release') await dispatchOrders(await adoptOrders([orderId]));
  else await cancelUnfulfillable(orderId, 'Cancelled after review');
  return { order_id: orderId, status };
}
