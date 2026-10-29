// Checks the shareable order receipt (src/receipt.ts). No database, no network. Run from frontend/:  npx tsx scripts/receipt-checks.ts
import { buildReceipt, type ReceiptLabels } from '../src/receipt';
import type { Order } from '../src/api';
let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => {
  if (!ok) { console.error(`FAIL  ${what}`, detail === undefined ? '' : JSON.stringify(detail)); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
};
const labels: ReceiptLabels = { title: 'Order receipt', order: 'Order', date: 'Date', store: 'Store', deliverTo: 'Deliver to', items: 'Items', subtotal: 'Item total', discount: 'Discount', delivery: 'Delivery fee', tax: 'GST', total: 'Total', payment: 'Payment', footer: 'Thank you.' };
const fmt = { money: (n: number) => `₹${n.toFixed(2)}`, date: (v: string) => v.slice(0, 10) };
const order = { id: '81f9d050-aea3-4f94-a98d-8fabfb8cdf8d', created_at: '2026-10-24T11:52:04Z', store_name: 'Demo Spice', address: { label: 'Home', text: 'Test House 1, Old MIDC', lat: null, lng: null, notes: '' },
  items: [{ id: 'a', name: 'Butter Naan', weight: '1 pc', price: 40, mrp: 40, image: '', qty: 2 }], subtotal: 80, discount: 10, delivery_fee: 15, gst: 4, total: 89 } as unknown as Order;
const text = buildReceipt(order, labels, fmt, 'UPI');
check('starts with the title and a short order number', text.startsWith('Order receipt\n\nOrder: #81F9D050'), text.split('\n').slice(0, 3));
check('shows the date, store and address', text.includes('Date: 2026-10-24') && text.includes('Store: Demo Spice') && text.includes('Deliver to: Test House 1, Old MIDC'));
check('each item shows quantity, name, pack and line total', text.includes('2 × Butter Naan (1 pc) — ₹80.00'));
check('the bill adds up as recorded: item total, discount, delivery, GST, total', ['Item total: ₹80.00', 'Discount: −₹10.00', 'Delivery fee: ₹15.00', 'GST: ₹4.00', 'Total: ₹89.00'].every(l => text.includes(l)));
check('the payment method and footer are included', text.includes('Payment: UPI') && text.trim().endsWith('Thank you.'));
const bare = buildReceipt({ ...order, store_name: undefined, address: null, discount: 0, gst: undefined } as unknown as Order, labels, fmt);
check('optional lines are left out, not printed empty', !bare.includes('Store:') && !bare.includes('Deliver to:') && !bare.includes('Discount:') && !bare.includes('GST:') && !bare.includes('Payment:'));
check('a free delivery still shows the fee line', buildReceipt({ ...order, delivery_fee: 0 } as unknown as Order, labels, fmt).includes('Delivery fee: ₹0.00'));
console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
