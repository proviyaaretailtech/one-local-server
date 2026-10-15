// Idempotency helper, order_transition wiring and the outbox publisher against the LOCAL Supabase (refuses anything else).
// Run from frontend/:  npx tsx scripts/idempotency-outbox-checks.ts   (needs frontend/.env.localdb.off)
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
for (const line of readFileSync(`${process.cwd()}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };
const thrown = async (f: () => Promise<unknown>) => { try { await f(); return null; } catch (e: any) { return e; } };

async function main() {
  const { db } = await import('../server/db');
  const { sha256 } = await import('../server/http');
  const { runIdempotent, idempotent, withStatus } = await import('../server/idempotency');
  const { publishOutbox, eventKind, outboxStuckCount } = await import('../server/outbox');
  const { cancelUnfulfillable } = await import('../server/refunds');
  const { pushToCustomer } = await import('../server/push');
  const health = await import('../app/api/health+api');
  const d = db();
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
  const tag = randomBytes(6).toString('hex');
  const scopeA = `zz-test:${tag}:a`, scopeB = `zz-test:${tag}:b`;
  const orders: string[] = [];
  try {
    // --- helper: replay / mismatch / scope / failure / no key
    let runs = 0;
    const work = async () => { runs++; return { status: 201, body: { n: runs } }; };
    const key = `k-${tag}-0001`;
    const r1 = await runIdempotent(scopeA, key, 'POST /x\n{"a":1}', work);
    const r2 = await runIdempotent(scopeA, key, 'POST /x\n{"a":1}', work);
    check('first call runs the work once', r1.replayed === false && r1.status === 201 && runs === 1, r1);
    check('same key + same request replays the stored response without running again', r2.replayed === true && r2.status === 201 && (r2.body as any).n === 1 && (r2.body as any).replayed === true && runs === 1, r2);
    const mism = await thrown(() => runIdempotent(scopeA, key, 'POST /x\n{"a":2}', work));
    check('same key + different request is 422 idempotency_mismatch', mism?.status === 422 && mism?.code === 'idempotency_mismatch' && runs === 1, mism && { s: mism.status, c: mism.code });
    const other = await runIdempotent(scopeB, key, 'POST /x\n{"a":2}', work);
    check('keys are scoped by caller: another caller can reuse the key', other.replayed === false && runs === 2);
    let release!: () => void;
    const slow = runIdempotent(scopeA, `k-${tag}-slow`, 'slow', () => new Promise(res => { release = () => res({ body: { done: true } }); }));
    await new Promise(r => setTimeout(r, 300));
    const busy = await thrown(() => runIdempotent(scopeA, `k-${tag}-slow`, 'slow', work));
    check('same key while the first call is still running is 409', busy?.status === 409 && busy?.code === 'in_progress', busy && { s: busy.status, c: busy.code });
    release(); await slow;
    let tries = 0;
    const failing = () => runIdempotent(scopeA, `k-${tag}-fail`, 'f', async () => { tries++; if (tries === 1) throw new Error('boom'); return { body: { ok: true } }; });
    check('a failed first call is rethrown', (await thrown(failing))?.message === 'boom');
    const again = await failing();
    check('after a failure the same key can be retried', again.replayed === false && tries === 2);
    let plain = 0;
    await runIdempotent(scopeA, null, 'x', async () => { plain++; return { body: 1 }; }); await runIdempotent(scopeA, null, 'x', async () => { plain++; return { body: 1 }; });
    check('no key: the work simply runs every time', plain === 2);

    // --- request helper: body stays readable, replay keeps status, no identity = no idempotency
    let hits = 0;
    const mkReq = (b: unknown, k = `k-${tag}-req1`) => new Request('http://localhost/api/orders', { method: 'POST', headers: { 'idempotency-key': k, 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const run = async (req: Request) => { hits++; const b = await req.json(); return withStatus(201, { echo: b, hits }); };
    const q1 = await idempotent(mkReq({ x: 1 }), `id:${tag}`, () => run(mkReq({ x: 1 })));
    const q2 = await idempotent(mkReq({ x: 1 }), `id:${tag}`, () => run(mkReq({ x: 1 })));
    check('route helper: first 201, repeat is a 201 replay of the same body', q1.status === 201 && q2.status === 201 && (await q2.json()).hits === 1 && hits === 1);
    const q3 = await thrown(() => idempotent(mkReq({ x: 9 }), `id:${tag}`, () => run(mkReq({ x: 9 }))));
    check('route helper: key reused with another body is 422', q3?.status === 422);
    const q4 = await thrown(() => idempotent(mkReq({ x: 1 }, 'short'), `id:${tag}`, async () => ({})));
    check('route helper: a malformed key is 400', q4?.status === 400);

    // --- order_transition wiring: cancelUnfulfillable
    const mk = async (over: Record<string, unknown> = {}) => {
      const id = crypto.randomUUID();
      must(await d.from('ol_orders').insert({ id, customer_hash: await sha256(`zz${tag}`), items: [], subtotal: 100, gst: 0, total: 100, payment_method: 'cod', payment_status: 'not_charged', status: 'placed', city_id: 'latur', ...over }));
      orders.push(id); return id;
    };
    const o1 = await mk();
    const c1 = await cancelUnfulfillable(o1, 'No restaurant could take it');
    const row = must(await d.from('ol_orders').select('status, cancel_reason').eq('id', o1).single());
    check('cancelUnfulfillable cancels a placed unadopted order through order_transition', c1.cancelled === true && row.status === 'cancelled' && row.cancel_reason === 'No restaurant could take it', { c1, row });
    const c2 = await cancelUnfulfillable(o1, 'again');
    check('cancelUnfulfillable twice is a no-op', c2.cancelled === false);
    const ev = must(await d.from('domain_events').select('id, payload, published_at').eq('aggregate_id', o1).eq('event_type', 'order.transitioned'));
    check('the transition left one outbox event (event ops_cancel -> cancelled)', ev.length === 1 && ev[0].payload.event === 'ops_cancel' && ev[0].payload.to === 'cancelled' && ev[0].published_at === null, ev);
    const o2 = await mk({ status: 'accepted' });
    check('cancelUnfulfillable leaves an accepted order alone', (await cancelUnfulfillable(o2, 'x')).cancelled === false);

    // --- outbox
    check('eventKind maps accepted/rejected/cancelled/picked_up/delivered', eventKind({ event: 'restaurant_accept', to: 'accepted' }) === 'accepted' && eventKind({ event: 'restaurant_reject', to: 'cancelled' }) === 'rejected'
      && eventKind({ event: 'customer_cancel', from: 'placed', to: 'cancelled' }) === 'cancelled' && eventKind({ event: 'delivery_sync_out', to: 'out' }) === 'picked_up'
      && eventKind({ event: 'delivered', to: 'delivered' }) === 'delivered' && eventKind({ event: 'kitchen_ready', to: 'packed' }) === null);
    const stuckBefore = await outboxStuckCount(0);
    check('outboxStuckCount counts unpublished events (a number, not a payload)', typeof stuckBefore === 'number' && stuckBefore >= 1, stuckBefore);
    const pub = await publishOutbox(1000);
    check('publishOutbox claims and publishes pending events', pub.claimed >= 1 && pub.published === pub.claimed - pub.failed && pub.failed === 0, pub);
    const after = must(await d.from('domain_events').select('published_at, publish_attempts').eq('id', ev[0].id).single());
    check('our event is marked published with an attempt counted', after.published_at !== null && after.publish_attempts >= 1, after);
    const pub2 = await publishOutbox(1000);
    check('a second run finds nothing left to claim for it', pub2.published <= pub.published);
    check('customer push is skipped, not faked, for a guest and for a customer with no registered phone', (await pushToCustomer(null, { title: 't', body: 'b', data: {} })).sent === 0 && (await pushToCustomer(crypto.randomUUID(), { title: 't', body: 'b', data: {} })).skipped === 'no_devices');
    const h = await (health as any).GET(new Request('http://localhost/api/health'));
    const hb = await h.json();
    check('/api/health reports only status, time and a stuck count', h.status === 200 && hb.status === 'ok' && typeof hb.outbox_stuck === 'number' && Object.keys(hb).sort().join() === 'outbox_stuck,status,time', hb);
  } finally {
    for (const s of [scopeA, scopeB, `http:id:${tag}`]) await d.from('idempotency_keys').delete().eq('scope', s);
    if (orders.length) await d.rpc('ol_dev_purge_orders', { p_ids: orders, p_reason: 'idempotency-outbox-checks cleanup' });
  }
  console.log(`\n${passed} checks passed${process.exitCode ? ', SOME FAILED' : ''}`);
}
main().catch(e => { console.error(e); process.exit(1); });
