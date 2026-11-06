// An earlier checkout turned back into cart lines (My Orders' reorder). The cart itself decides
// food vs shopping and the restaurant from the catalogue (src/cart.tsx addMany), so only what the order recorded is passed.
import type { Order } from './api';

export const reorderLines = (orders: Order[]) =>
  orders.flatMap(o => o.items.map(it => ({ product: { id: it.id, name: it.name, weight: it.weight, price: it.price, mrp: it.mrp, image: it.image, store_id: o.store_id ?? undefined }, qty: it.qty })));
