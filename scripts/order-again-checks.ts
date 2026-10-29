// Checks the "Order again" rules (src/reorder.ts): which checkout is offered and what goes back into the bag. No database, no network.
// Run from frontend/:  npx tsx scripts/order-again-checks.ts
import { pickLastCheckout, reorderLines } from '../src/reorder';
import type { Order } from '../src/api';
let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => {
  if (!ok) { console.error(`FAIL  ${what}`, detail === undefined ? '' : JSON.stringify(detail)); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
};
const item = (id: string, qty = 1) => ({ id, name: `Item ${id}`, weight: '1 pc', price: 10, mrp: 12, image: '', qty });
const order = (id: string, over: Partial<Order> = {}) => ({ id, status: 'placed', created_at: '2026-10-20T10:00:00Z', items: [item('a')], total: 10, subtotal: 10, discount: 0, delivery_fee: 0, ...over } as unknown as Order);

check('no orders: nothing to offer', pickLastCheckout([]) === null && pickLastCheckout(undefined) === null);
check('only cancelled orders: nothing to offer', pickLastCheckout([order('1', { status: 'cancelled' })]) === null);
check('the newest order wins', pickLastCheckout([order('old', { created_at: '2026-10-01T00:00:00Z' }), order('new', { created_at: '2026-10-25T00:00:00Z' })])?.[0].id === 'new');
check('a newer cancelled order is skipped for an older good one', pickLastCheckout([order('good'), order('bad', { status: 'cancelled', created_at: '2026-10-26T00:00:00Z' })])?.[0].id === 'good');
const together = pickLastCheckout([order('s1', { checkout_id: 'c1', store_id: 'x', created_at: '2026-10-25T00:00:01Z' }), order('s2', { checkout_id: 'c1', store_id: 'y', created_at: '2026-10-25T00:00:00Z' }), order('other', { created_at: '2026-10-20T00:00:00Z' })]);
check('orders paid together come back together, others do not', together?.length === 2 && together.every(o => o.checkout_id === 'c1'));
check('an order with no items is ignored', pickLastCheckout([order('empty', { items: [] })]) === null);
const lines = reorderLines([order('o', { store_id: 'store-1', items: [item('a', 2), item('b')] })]);
check('every item goes back with its quantity and store', lines.length === 2 && lines[0].qty === 2 && lines[0].product.id === 'a' && lines[0].product.store_id === 'store-1');
check('an order with no store id adds none', reorderLines([order('n', { store_id: null })])[0].product.store_id === undefined);
console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
