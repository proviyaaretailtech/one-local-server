// An earlier checkout turned back into cart lines (My Orders and the Home "Order again" card use the same rule). The cart itself decides
// food vs shopping and the restaurant from the catalogue (src/cart.tsx addMany), so only what the order recorded is passed.
import type { Order } from './api';

export const reorderLines = (orders: Order[]) =>
  orders.flatMap(o => o.items.map(it => ({ product: { id: it.id, name: it.name, weight: it.weight, price: it.price, mrp: it.mrp, image: it.image, store_id: o.store_id ?? undefined }, qty: it.qty })));

/** The newest checkout that was not cancelled (every store order in it), or null. Orders with no items are ignored. */
export function pickLastCheckout(orders: readonly Order[] | undefined): Order[] | null {
  const live = [...(orders ?? [])].filter(o => o.status !== 'cancelled' && o.items.length).sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!live.length) return null;
  const key = live[0].checkout_id ?? live[0].id;
  return live.filter(o => (o.checkout_id ?? o.id) === key);
}
