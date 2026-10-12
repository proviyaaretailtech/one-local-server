// Refund completion worker (server/refunds.ts completeQueuedRefunds + migration 0235) against the LOCAL Supabase with an INJECTED FAKE gateway:
// nothing here can reach Razorpay. Checks: a queued refund is made once and its gateway id stored, a gateway failure is retried with backoff using the
// same idempotency key, N failures leave it failed and open an ops exception, no gateway = nothing claimed, two workers never double refund, the
// direct refund path never refunds money the queue already owns. Refuses anything but localhost; cleans up after itself.
// Run from frontend/:  npx tsx scripts/refund-worker-checks.ts   (needs frontend/.env.localdb.off)
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
for (const line of readFileSync(`${process.cwd()}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');
delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET; delete process.env.CASHFREE_PG_APP_ID; delete process.env.CASHFREE_PG_SECRET_KEY; // the real gateway must be impossible in this script

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };

async function main() {
  const { db } = await import('../server/db');
  const { setRefundGateway } = await import('../server/razorpay');
  const { completeQueuedRefunds, refundOrderShare, REFUND_MAX_ATTEMPTS } = await import('../server/refunds');
  const d = db();
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };

  type Call = { paymentId: string; amountMinor: number; idempotencyKey: string };
  const calls: Call[] = [];
  let behaviour: (c: Call) => Promise<{ id: string; status?: string }> = async c => ({ id: `rfnd_ZZ${c.idempotencyKey.slice(-8)}`, status: 'processed' });
  const fake = { createRefund: async (a: any) => { calls.push({ paymentId: a.paymentId, amountMinor: a.amountMinor, idempotencyKey: a.idempotencyKey }); return behaviour(a); } };

  // The queue is shared with whatever else is in the dev database: park other people's queued refunds (method -> manual, which the worker ignores) so the worker, which
  // claims ANY queued refund, cannot touch them, and put them back at the end. (Status cannot be used: the 0218 guard forbids going back.)
  const parked = must(await d.from('ol_refunds').select('id').in('status', ['requested', 'gateway_pending', 'failed']).eq('method', 'original'));
  if (parked.length) must(await d.from('ol_refunds').update({ method: 'manual' }).in('id', parked.map((r: any) => r.id))); // the worker only touches method 'original'
  const made: string[] = [];
  const mkOrder = async () => {
    const id = crypto.randomUUID(), pay = `pay_zz${randomBytes(5).toString('hex')}`;
    must(await d.from('ol_orders').insert({ id, customer_hash: `zz${randomBytes(8).toString('hex')}`, items: [], subtotal: 200, gst: 0, total: 200, payment_method: 'upi', payment_status: 'paid', razorpay_payment_id: pay, status: 'cancelled', city_id: 'latur' }));
    made.push(id);
    return { id, pay };
  };
  const queue = async (orderId: string) => must(await d.from('ol_refunds').insert({ order_id: orderId, amount: 200, reason: 'Order could not be fulfilled', method: 'original', status: 'requested', idempotency_key: `compensate:${orderId}` }).select('id'))[0].id as string;
  const refund = async (id: string) => must(await d.from('ol_refunds').select('status, reference, gateway_reference, attempts, last_error, claimed_at').eq('id', id))[0];
  const back = async (id: string, seconds: number) => must(await d.from('ol_refunds').update({ claimed_at: new Date(Date.now() - seconds * 1000).toISOString() }).eq('id', id));
  const openExceptions = async (orderId: string) => must(await d.from('payment_reconciliation_exceptions').select('id, details').eq('ref_key', orderId).eq('status', 'open'));

  try {
    // --- no gateway (no keys, nothing injected): nothing is claimed
    const o0 = await mkOrder(), r0 = await queue(o0.id);
    setRefundGateway(null);
    const none = await completeQueuedRefunds();
    check('no gateway: the worker skips and claims nothing', none.skipped === 'no_gateway' && none.claimed === 0 && (await refund(r0)).status === 'requested' && (await refund(r0)).attempts === 0, none);

    // --- the direct path never refunds money the queue owns
    const direct = await refundOrderShare({ id: o0.id, total: 200 }, o0.pay, 'test');
    check('direct refund path sees the queued refund and does nothing', direct === 'nothing_to_refund', direct);

    // --- happy path
    setRefundGateway(fake);
    const ok1 = await completeQueuedRefunds();
    const f1 = await refund(r0);
    check('queued refund is made once at the gateway with its paise amount and a stable key', ok1.completed === 1 && calls.length === 1 && calls[0].amountMinor === 20000 && calls[0].paymentId === o0.pay && calls[0].idempotencyKey === `ol-refund-q-${r0}`, { ok1, calls });
    check('gateway refund id is stored via ol_refund_complete; refund processed; order refunded', f1.status === 'processed' && f1.reference === f1.gateway_reference && /^rfnd_ZZ/.test(f1.reference) && must(await d.from('ol_orders').select('payment_status').eq('id', o0.id))[0].payment_status === 'refunded', f1);
    await completeQueuedRefunds();
    check('a processed refund is never sent again', calls.length === 1);

    // --- failure, backoff, then success with the SAME idempotency key
    calls.length = 0;
    const o2 = await mkOrder(), r2 = await queue(o2.id);
    let failures = 1;
    behaviour = async c => { if (failures-- > 0) throw new Error('gateway 502'); return { id: 'rfnd_ZZretry', status: 'processed' }; };
    const a1 = await completeQueuedRefunds();
    check('gateway failure: refund is failed with the error, attempt 1', a1.failed === 1 && (await refund(r2)).status === 'failed' && (await refund(r2)).attempts === 1 && /502/.test((await refund(r2)).last_error), await refund(r2));
    const a2 = await completeQueuedRefunds();
    check('inside the backoff it is not retried', a2.requeued === 0 && calls.length === 1 && (await refund(r2)).status === 'failed', a2);
    await back(r2, 61);
    const a3 = await completeQueuedRefunds();
    check('after the backoff it is retried and completes', a3.requeued === 1 && a3.completed === 1 && (await refund(r2)).status === 'processed' && (await refund(r2)).reference === 'rfnd_ZZretry', a3);
    check('the retry used the same idempotency key (so Razorpay cannot refund twice)', calls.length === 2 && calls[0].idempotencyKey === calls[1].idempotencyKey, calls);

    // --- exhaustion: N attempts then failed + an exception for operations, and no more gateway calls
    calls.length = 0;
    const o3 = await mkOrder(), r3 = await queue(o3.id);
    behaviour = async () => { throw new Error('gateway down'); };
    for (let i = 0; i < REFUND_MAX_ATTEMPTS; i++) { await completeQueuedRefunds(); await back(r3, 3600); }
    const ex = await completeQueuedRefunds();
    const f3 = await refund(r3);
    check(`after ${REFUND_MAX_ATTEMPTS} attempts the refund stays failed`, f3.status === 'failed' && f3.attempts === REFUND_MAX_ATTEMPTS && calls.length === REFUND_MAX_ATTEMPTS, { f3, calls: calls.length });
    const exc = await openExceptions(o3.id);
    check('an exception is open for operations (refund id, attempts)', exc.length === 1 && exc[0].details?.refund_id === r3 && ex.exhausted >= 1, exc);
    await completeQueuedRefunds();
    check('no further gateway calls and no duplicate exception', calls.length === REFUND_MAX_ATTEMPTS && (await openExceptions(o3.id)).length === 1);
    // operations retry once the gateway is back: processed, exception closes
    behaviour = async () => ({ id: 'rfnd_ZZops', status: 'processed' });
    must(await d.rpc('ol_refund_retry', { p_refund: r3 }));
    await completeQueuedRefunds();
    check('operations retry after the fix completes it and closes the exception', (await refund(r3)).status === 'processed' && (await openExceptions(o3.id)).length === 0);

    // --- two workers at once: one gateway call
    calls.length = 0;
    const o4 = await mkOrder(), r4 = await queue(o4.id);
    behaviour = async c => { await new Promise(r => setTimeout(r, 150)); return { id: 'rfnd_ZZpar', status: 'processed' }; };
    const [w1, w2] = await Promise.all([completeQueuedRefunds(), completeQueuedRefunds()]);
    check('two workers at once refund once', calls.length === 1 && w1.completed + w2.completed === 1 && (await refund(r4)).status === 'processed', { calls: calls.length, w1, w2 });

    // --- a gateway answer without an id is a failure, not a success
    const o5 = await mkOrder(), r5 = await queue(o5.id);
    behaviour = async () => ({} as any);
    await completeQueuedRefunds();
    check('a gateway answer with no refund id is not booked as processed', (await refund(r5)).status === 'failed', await refund(r5));
  } finally {
    setRefundGateway(null);
    if (parked.length) await d.from('ol_refunds').update({ method: 'original' }).in('id', parked.map((r: any) => r.id));
    for (const id of made) {
      await d.from('payment_reconciliation_exceptions').delete().eq('ref_key', id);
      await d.from('ol_refunds').delete().eq('order_id', id);
      await d.from('ol_orders').delete().eq('id', id);
    }
  }
  console.log(`${passed} checks passed`);
}
main().catch(e => { console.error(e); process.exit(1); });
