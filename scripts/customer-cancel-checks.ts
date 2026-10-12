// Customer cancel + preview routes, through the real route files against the LOCAL Supabase: ownership, the stage rule, the
// refund share, replay, too-late, the Idempotency-Key shape and the rate limit. Sign-in is not needed (orders are owned by a device
// key). Refuses anything but localhost. Orders it creates are plain unadopted ol_orders and are deleted at the end where the
// database allows it.
// Run from frontend/:  npx tsx scripts/customer-cancel-checks.ts   (needs frontend/.env.localdb.off)
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
for (const line of readFileSync(`${process.cwd()}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };

async function main() {
  const { db } = await import('../server/db');
  const { sha256 } = await import('../server/http');
  const route = await import('../app/api/orders/[id]/cancel+api');
  const d = db();
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
  const deviceA = `zz${randomBytes(16).toString('hex')}`, deviceB = `zz${randomBytes(16).toString('hex')}`;
  const hashA = await sha256(deviceA);
  const call = async (method: 'GET' | 'POST', id: string, device: string | null, body?: unknown, headers: Record<string, string> = {}) => {
    const req = new Request(`http://localhost/api/orders/${id}/cancel`, { method, headers: { ...(device ? { 'x-customer-key': device } : {}), 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const res = await (route as any)[method](req, { id });
    return { status: res.status, body: await res.json() };
  };
  const mk = async (over: Record<string, unknown> = {}) => {
    const id = crypto.randomUUID();
    must(await d.from('ol_orders').insert({ id, customer_hash: hashA, items: [], subtotal: 200, gst: 0, total: 200, payment_method: 'cod', payment_status: 'not_charged', status: 'placed', city_id: 'latur', ...over }));
    return id;
  };
  const made: string[] = [];
  try {
    // --- cash order, before the restaurant accepts
    const cash = await mk(); made.push(cash);
    const p1 = await call('GET', cash, deviceA);
    check('preview: placed cash order can be cancelled, nothing to refund', p1.status === 200 && p1.body.can_cancel === true && p1.body.stage === 'before_accept' && p1.body.paid_online === false && p1.body.refund_amount === 0, p1);
    check('preview: another device sees 404, not the order', (await call('GET', cash, deviceB)).status === 404);
    check('preview: no identity at all sees 404', (await call('GET', cash, null)).status === 404);
    check('cancel: another device cannot cancel it', (await call('POST', cash, deviceB, { reason: 'x' })).status === 404);
    check('cancel: a malformed id is 404', (await call('POST', 'not-a-uuid', deviceA, { reason: 'x' })).status === 404);
    check('cancel: no reason is refused (400) and the order stays placed', (await call('POST', cash, deviceA, {})).status === 400 && must(await d.from('ol_orders').select('status').eq('id', cash))[0].status === 'placed');
    check('cancel: a bad Idempotency-Key is refused', (await call('POST', cash, deviceA, { reason: 'x' }, { 'idempotency-key': 'short' })).status === 400);
    const c1 = await call('POST', cash, deviceA, { reason: 'changed_mind', refund_amount: 9999, refund_pct: 100 }, { 'idempotency-key': 'zz-key-0001' });
    check('cancel: cash order cancelled, no refund, client amounts ignored', c1.status === 200 && c1.body.status === 'cancelled' && c1.body.refund === null && c1.body.replayed === false && c1.body.idempotency_key === 'zz-key-0001', c1);
    const c2 = await call('POST', cash, deviceA, { reason: 'changed_mind' }, { 'idempotency-key': 'zz-key-0001' });
    check('cancel: a repeat is a replay, not an error', c2.status === 200 && c2.body.replayed === true, c2);
    const p2 = await call('GET', cash, deviceA);
    check('preview: after cancel says already_cancelled', p2.body.can_cancel === false && p2.body.blocked_reason === 'already_cancelled', p2);
    check('cancel row says customer, before_accept', must(await d.from('order_cancellations').select('initiated_by, stage').eq('ol_order_id', cash))[0]?.initiated_by === 'customer');

    // --- paid online order: preview refund must equal the refund the database queues
    for (const [status, pct] of [['placed', 100], ['accepted', 50], ['packed', 0]] as const) {
      const id = await mk({ payment_method: 'upi', payment_status: 'paid', razorpay_payment_id: `pay_zz${randomBytes(4).toString('hex')}`, status, total: 200 }); made.push(id); // fixture inserted already in its status: direct status updates are refused (0229)
      const pv = await call('GET', id, deviceA);
      check(`preview (${status}): refund ${pct}% of what was captured, fee is the rest`, pv.body.can_cancel && pv.body.refund_pct === pct && Math.abs(pv.body.refund_amount + pv.body.fee_amount - pv.body.paid_amount) < 0.005, pv);
      const c = await call('POST', id, deviceA, { reason: 'too_slow' });
      const queued = must(await d.from('ol_refunds').select('amount, status').eq('order_id', id));
      const queuedSum = queued.reduce((n: number, r: any) => n + Number(r.amount), 0);
      check(`cancel (${status}): ok, stage reported, queued refund equals the preview`, c.status === 200 && c.body.refund_pct === pct && Math.abs(queuedSum - pv.body.refund_amount) < 0.005 && (pv.body.refund_amount > 0 ? c.body.refund?.amount === pv.body.refund_amount : c.body.refund === null), { c, queued, pv });
    }

    // --- already on its way
    const out = await mk({ status: 'out' }); made.push(out);
    const po = await call('GET', out, deviceA);
    check('preview: out for delivery is too_late', po.body.can_cancel === false && po.body.blocked_reason === 'too_late', po);
    const co = await call('POST', out, deviceA, { reason: 'x' });
    check('cancel: out for delivery -> 409 too_late', co.status === 409 && co.body.code === 'too_late', co);

    // --- rate limit: the 11th cancel attempt a minute from one device is refused (the limiter counts before it looks the order up)
    const flood = `zz${randomBytes(16).toString('hex')}`;
    let last = 0; for (let i = 0; i < 12; i++) last = (await call('POST', crypto.randomUUID(), flood, { reason: 'x' })).status;
    check('cancel: flooding from one device is rate limited (429)', last === 429, last);
  } finally {
    for (const id of made) { await d.from('ol_refunds').delete().eq('order_id', id); await d.from('ol_orders').delete().eq('id', id); }
    console.log(`${passed} checks passed`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
