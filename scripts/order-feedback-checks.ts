// Checks what a customer may send when rating an order or reporting an item (server/order-feedback-rules.ts). No database, no network.
// Run from frontend/:  npx tsx scripts/order-feedback-checks.ts
import { HttpError } from '../server/http';
import { MAX_TEXT, parseIssue, parseRating } from '../server/order-feedback-rules';
let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => {
  if (!ok) { console.error(`FAIL  ${what}`, detail === undefined ? '' : JSON.stringify(detail)); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
};
const refused = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return e instanceof HttpError ? e : new Error('not an HttpError'); } };
const items = [{ id: 'i1', qty: 2 }, { id: 'i2', qty: 1 }];

check('5 stars with a comment is accepted', JSON.stringify(parseRating({ rating: 5, comment: '  Fresh   and fast ' })) === JSON.stringify({ rating: 5, delivery_rating: null, comment: 'Fresh and fast' }));
check('delivery stars are optional but kept', parseRating({ rating: 4, delivery_rating: 3 }).delivery_rating === 3);
for (const bad of [0, 6, 3.5, '4', null, undefined]) check(`rating ${JSON.stringify(bad)} is refused with a 400`, refused(() => parseRating({ rating: bad }))?.['status' as never] === 400);
check('delivery stars out of range are refused', (refused(() => parseRating({ rating: 4, delivery_rating: 9 })) as HttpError)?.status === 400);
check('a comment over the limit is refused', (refused(() => parseRating({ rating: 4, comment: 'x'.repeat(MAX_TEXT + 1) })) as HttpError)?.status === 400);
check('a non-object body is refused', (refused(() => parseRating('hello')) as HttpError)?.status === 400 && (refused(() => parseRating([1])) as HttpError)?.status === 400);

const ok = parseIssue({ order_item_id: 'i1', kind: 'missing', qty: 2, note: ' one pack ' }, items);
check('a valid report is accepted and tidied', ok.order_item_id === 'i1' && ok.kind === 'missing' && ok.qty === 2 && ok.note === 'one pack');
check('quantity defaults to 1', parseIssue({ order_item_id: 'i2', kind: 'damaged' }, items).qty === 1);
check('more pieces than were bought are refused', (refused(() => parseIssue({ order_item_id: 'i2', kind: 'missing', qty: 2 }, items)) as HttpError)?.status === 400);
check('zero, fractional or text quantity is refused', [0, 1.5, '1'].every(q => (refused(() => parseIssue({ order_item_id: 'i1', kind: 'wrong', qty: q }, items)) as HttpError)?.status === 400));
check('an item that is not in this order is refused', (refused(() => parseIssue({ order_item_id: 'someone-elses', kind: 'wrong' }, items)) as HttpError)?.status === 400);
check('an unknown kind is refused', (refused(() => parseIssue({ order_item_id: 'i1', kind: 'refund-me-please' }, items)) as HttpError)?.status === 400);
check('a report with no item is refused', (refused(() => parseIssue({ kind: 'missing' }, items)) as HttpError)?.status === 400);
check('all four kinds are accepted', ['missing', 'wrong', 'damaged', 'quality'].every(kind => parseIssue({ order_item_id: 'i1', kind }, items).kind === kind));
check('errors carry a machine code', (refused(() => parseIssue({}, items)) as HttpError)?.code === 'invalid_issue');
console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
