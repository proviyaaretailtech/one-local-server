// Checks the "Order again" rule (src/reorder.ts): what goes back into the bag. No database, no network.
// Run from frontend/:  npx tsx scripts/order-again-checks.ts
import { reorderLines } from '../src/reorder';
import type { Order } from '../src/api';
let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => {
  if (!ok) { console.error(`FAIL  ${what}`, detail === undefined ? '' : JSON.stringify(detail)); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
};
const item = (id: string, qty = 1) => ({ id, name: `Item ${id}`, weight: '1 pc', price: 10, mrp: 12, image: '', qty });
const order = (id: string, over: Partial<Order> = {}) => ({ id, status: 'placed', created_at: '2026-10-20T10:00:00Z', items: [item('a')], total: 10, subtotal: 10, discount: 0, delivery_fee: 0, ...over } as unknown as Order);

const lines = reorderLines([order('o', { store_id: 'store-1', items: [item('a', 2), item('b')] })]);
check('every item goes back with its quantity and store', lines.length === 2 && lines[0].qty === 2 && lines[0].product.id === 'a' && lines[0].product.store_id === 'store-1');
check('an order with no store id adds none', reorderLines([order('n', { store_id: null })])[0].product.store_id === undefined);
console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
