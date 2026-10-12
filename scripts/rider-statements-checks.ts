// GET /rider/statements/:week (JSON and .pdf) and POST /rider/statements/:week/email, through the real route files against the
// LOCAL Supabase. Sign-in is simulated; the database is real. Refuses anything but localhost.
// Fixture: one rider (zz-rider-statements@example.test) with two deliveries paid in ISO week 2026-W01 (Mon 29 Dec 2025 - Sun 4 Jan 2026,
// Indian time): job 1 fee 500.00 + tip 20.00 + bonus 10.00; job 2 fee 300.00, later forced-cancelled, so a -300.00 cash_adjustment.
// rider_earnings is append-only, so the fixture is created once and reused on every run (delivery jobs/orders stay, tagged ZZ-TEST).
// Run from frontend/:  npx tsx scripts/rider-statements-checks.ts   (needs frontend/.env.localdb.off)
import { readFileSync } from 'node:fs';
for (const line of readFileSync(`${process.cwd()}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };
const tokenToUser = new Map<string, string>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith('/auth/v1/user')) { const t = String(init?.headers?.Authorization ?? init?.headers?.authorization ?? '').slice(7); return tokenToUser.has(t) ? Response.json({ id: tokenToUser.get(t) }) : new Response('{}', { status: 401 }); }
  return realFetch(input, init);
}) as typeof fetch;

async function main() {
  const { db } = await import('../server/db');
  const { parseWeek } = await import('../server/rider-statements');
  const week = await import('../app/api/rider/statements/[week]+api');
  const mail = await import('../app/api/rider/statements/[week]/email+api');
  const d = db();
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
  const EMAIL = 'zz-rider-statements@example.test';
  const list = (await d.auth.admin.listUsers({ perPage: 1000 })).data.users;
  let uid = list.find(u => u.email === EMAIL)?.id;
  if (!uid) { const c = await d.auth.admin.createUser({ email: EMAIL, phone: '919900000077', email_confirm: true, phone_confirm: true }); if (c.error) throw new Error(c.error.message); uid = c.data.user!.id; }
  let rider = (must(await d.from('riders').select('id').eq('user_id', uid)) as any[])[0]?.id as string | undefined;
  if (!rider) rider = must(await d.from('riders').insert({ user_id: uid, full_name: 'ZZ Statement Rider', type: 'solo', status: 'approved', vehicle: 'bike' }).select('id'))[0].id;
  const other = list.find(u => u.email === 'zz-rider-extra-a@example.test')?.id;

  const jobs: string[] = [];
  for (const n of [1, 2]) {
    const key = `zz-rs-${n}`;
    let job = (must(await d.from('delivery_jobs').select('id').eq('idempotency_key', key)) as any[])[0]?.id;
    if (!job) {
      const order = must(await d.from('ol_orders').insert({ customer_hash: 'ZZ-TEST rider-statements', items: [], subtotal: 100, total: 100 }).select('id'))[0].id;
      job = must(await d.from('delivery_jobs').insert({ ol_order_id: order, city_id: 'latur', status: 'delivered', step: null, delivered_at: '2026-01-01T10:00:00Z', idempotency_key: key, rider_id: rider, payment_mode: 'cod',
        cash_to_collect: 0, items_count: 1, pickup_name: 'ZZ Kitchen', pickup_lat: 18.4088, pickup_lng: 76.5604, drop_area: 'Gandhi Chowk', drop_lat: 18.4001, drop_lng: 76.5702, customer_first_name: 'Asha', customer_phone: '+919888800001', otp_hash: 'zz' }).select('id'))[0].id;
    }
    jobs.push(job);
  }
  if (!(must(await d.from('rider_earnings').select('id').eq('rider_id', rider).eq('delivery_job_id', jobs[0])) as any[]).length) {
    must(await d.from('rider_earnings').insert([
      { rider_id: rider, delivery_job_id: jobs[0], kind: 'delivery_fee', amount_minor: 50000, created_at: '2025-12-30T08:00:00Z' },
      { rider_id: rider, delivery_job_id: jobs[0], kind: 'tip', amount_minor: 2000, created_at: '2025-12-30T08:01:00Z' },
      { rider_id: rider, delivery_job_id: jobs[0], kind: 'bonus', amount_minor: 1000, created_at: '2026-01-04T18:00:00Z' }, // Sun 23:30 IST, still W01
      { rider_id: rider, delivery_job_id: jobs[1], kind: 'delivery_fee', amount_minor: 30000, created_at: '2026-01-01T08:00:00Z' },
      { rider_id: rider, delivery_job_id: jobs[1], kind: 'cash_adjustment', amount_minor: -30000, created_at: '2026-01-02T08:00:00Z' },
      { rider_id: rider, delivery_job_id: jobs[0], kind: 'tip', amount_minor: 99900, created_at: '2026-01-04T18:31:00Z' }, // Mon 00:01 IST = W02, must NOT be in W01
    ]));
  }
  const jwt = (id: string) => { const t = `token-${id}-`.padEnd(60, 'x'); tokenToUser.set(t, id); return t; };
  const req = (who: string | null, method: string, url: string) => new Request(`http://localhost/api/${url}`, { method, headers: who ? { authorization: `Bearer ${jwt(who)}` } : {} });

  check('parseWeek: 2026-W01 starts Monday 29 Dec 2025 00:00 IST', new Date(parseWeek('2026-W01').start).toISOString() === '2025-12-28T18:30:00.000Z');
  for (const bad of ['2026-W00', '2026-W54', '2025-W53', 'x', '2026-W1', '../etc']) { let code = 0; try { parseWeek(bad); } catch (e: any) { code = e.status; } check(`parseWeek: ${bad} is 404`, code === 404, code); }

  const r = await week.GET(req(uid, 'GET', 'rider/statements/2026-W01'), { week: '2026-W01' });
  const s: any = await r.json();
  check('statement: 200 with the signed totals (500+20+10+300-300 = 530.00)', r.status === 200 && s.totals.total === 530 && s.totals.delivery_fees === 800 && s.totals.tips === 20 && s.totals.bonus === 10 && s.totals.cash_adjustments === -300, s.totals);
  check('statement: counts both deliveries, period is Mon-Sun IST', s.totals.deliveries === 2 && s.period.from === '2025-12-29' && s.period.to === '2026-01-04', s.period);
  check('statement: Mon 00:01 IST (next week) tip is left out; Sun 23:30 IST bonus is in', !s.lines.some((l: any) => l.amount === 999) && s.lines.some((l: any) => l.kind === 'bonus'));
  check('statement: seven days, sums to the total', s.days.length === 7 && Math.round(s.days.reduce((n: number, x: any) => n + x.total, 0) * 100) / 100 === 530, s.days);
  const dotPdf = await week.GET(req(uid, 'GET', 'rider/statements/2026-W01.pdf'), { week: '2026-W01.pdf' });
  const bytes = new Uint8Array(await dotPdf.arrayBuffer());
  check('statement .pdf: application/pdf, starts %PDF, ends %%EOF', dotPdf.headers.get('content-type') === 'application/pdf' && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-' && new TextDecoder().decode(bytes.slice(-6)).trim() === '%%EOF');
  check('statement: no sign-in is 401', (await week.GET(req(null, 'GET', 'rider/statements/2026-W01'), { week: '2026-W01' })).status === 401);
  check('statement: bad week is 404', (await week.GET(req(uid, 'GET', 'rider/statements/nope'), { week: 'nope' })).status === 404);
  if (other) {
    const o: any = await (await week.GET(req(other, 'GET', 'rider/statements/2026-W01'), { week: '2026-W01' })).json();
    check("statement: another rider's statement does not include this rider's money", o.totals?.total !== 530 && !(o.lines ?? []).some((l: any) => l.job_id === jobs[0]), o.totals);
  }
  const empty: any = await (await week.GET(req(uid, 'GET', 'rider/statements/2020-W10'), { week: '2020-W10' })).json();
  check('statement: an empty week is zeros, not an error', empty.totals.total === 0 && empty.lines.length === 0);

  // email: queue, never fake a send
  must(await d.from('riders').update({ email: null }).eq('id', rider));
  const noMail = await mail.POST(req(uid, 'POST', 'rider/statements/2026-W01/email'), { week: '2026-W01' });
  check('email: no address on file -> 422 validation (the app sends the rider to the profile)', noMail.status === 422 && (await noMail.json()).code === 'validation');
  must(await d.from('riders').update({ email: 'asha.rider@example.test' }).eq('id', rider));
  await d.from('rider_notifications').delete().eq('rider_id', rider).eq('kind', 'statement_email_requested');
  const em = await mail.POST(req(uid, 'POST', 'rider/statements/2026-W01/email'), { week: '2026-W01' });
  const eb: any = await em.json();
  check('email: honest receipt (skipped, not sent), address masked', em.status === 200 && eb.status === 'skipped' && eb.channel === 'email' && eb.queued === true && eb.to_masked === 'a***@example.test', eb);
  await mail.POST(req(uid, 'POST', 'rider/statements/2026-W01/email'), { week: '2026-W01' });
  check('email: a repeat queues once', (must(await d.from('rider_notifications').select('id').eq('rider_id', rider).eq('kind', 'statement_email_requested')) as any[]).length === 1);
  check('email: no sign-in is 401', (await mail.POST(req(null, 'POST', 'rider/statements/2026-W01/email'), { week: '2026-W01' })).status === 401);
  await d.from('rider_notifications').delete().eq('rider_id', rider).eq('kind', 'statement_email_requested');
  console.log(`${passed} checks passed`);
}
main().catch(e => { console.error(e); process.exit(1); });
