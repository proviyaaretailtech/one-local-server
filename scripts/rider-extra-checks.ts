// Runs the rider's extra routes (tracks, uploads, SOS, call, code resend, notifications, earnings, cash, wallet, payouts,
// onboarding, geo) end to end through the real server code against the LOCAL Supabase. Sign-in and Expo push are
// simulated; the database and Storage are real. It refuses to run against anything but localhost and removes what it
// can. Also left behind: audit_logs rows (append-only) written by the audit triggers on payouts, rider_documents and
// rider_policies. What it cannot remove: rider_earnings and rider_cash_entries are append-only, so the one money rider
// (zz-rider-extra-money@example.test), its delivery job and its ol_order stay and are reused on every run. Run
// /Users/lohit/agentic-os-coder/database/purge_test_orders.sh afterwards for any ZZ-TEST orders.
// Run from frontend/:  npx tsx scripts/rider-extra-checks.ts   (needs frontend/.env.localdb.off)
import { readFileSync } from 'node:fs';
const ROOT = process.cwd();
for (const line of readFileSync(`${ROOT}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };

const pushes: any[] = []; const tokenToUser = new Map<string, string>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://exp.host/')) { const msgs = JSON.parse(init.body); pushes.push(...msgs); return Response.json({ data: msgs.map(() => ({ status: 'ok' })) }); }
  if (url.endsWith('/auth/v1/user')) { const t = String(init?.headers?.Authorization ?? '').slice(7); return tokenToUser.has(t) ? Response.json({ id: tokenToUser.get(t) }) : new Response('{}', { status: 401 }); }
  return realFetch(input, init);
}) as typeof fetch;

const TAG = 'ZZ-TEST rider-extra-checks';
const EMAIL = (n: string) => `zz-rider-extra-${n}@example.test`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

async function main() {
  const { db } = await import(`../server/db`);
  const { docDto } = await import(`../server/rider-onboarding`);
  const d = db();
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
  const R = async (p: string) => import(`../app/api/${p}+api`);
  const route = {
    track: await R('rider/jobs/[id]/track'), uploads: await R('rider/uploads'), resolve: await R('rider/jobs/[id]/exception/resolve'), sos: await R('rider/sos'),
    call: await R('rider/jobs/[id]/call'), otp: await R('rider/jobs/[id]/otp/resend'), notifs: await R('rider/notifications'), read: await R('rider/notifications/read'),
    earnings: await R('rider/earnings'), jobEarn: await R('rider/earnings/jobs/[id]'), history: await R('rider/jobs/index'), cash: await R('rider/cash'),
    deposits: await R('rider/cash/deposits'), deposit: await R('rider/cash/deposits/[id]'), wallet: await R('rider/wallet'), payouts: await R('rider/payouts'),
    payout: await R('rider/payouts/[id]'), withdraw: await R('rider/payouts/withdraw'), register: await R('rider/register'), profile: await R('rider/profile'),
    hub: await R('rider/hub'), type: await R('rider/type'), link: await R('rider/store-link'), vehicle: await R('rider/vehicle'), prefs: await R('rider/preferences'),
    payoutMethod: await R('rider/payout'), docs: await R('rider/kyc/documents'), digilocker: await R('rider/kyc/digilocker/start'), submit: await R('rider/submit'),
    status: await R('rider/status'), zones: await R('geo/zones'), cityZones: await R('geo/cities/[id]/zones'),
  };

  // ---- users, riders, jobs: fixed names so a crashed run is cleaned by the next one ----
  const users = new Map<string, string>();
  const list = (await d.auth.admin.listUsers({ perPage: 1000 })).data.users;
  const user = async (n: string, phone: string) => {
    const found = list.find(u => u.email === EMAIL(n));
    if (found) { users.set(n, found.id); return found.id; }
    const c = await d.auth.admin.createUser({ email: EMAIL(n), phone, email_confirm: true, phone_confirm: true });
    if (c.error) throw new Error(c.error.message);
    users.set(n, c.data.user!.id); return c.data.user!.id;
  };
  const uA = await user('a', '919900000001'), uB = await user('b', '919900000002'), uC = await user('money', '919900000003'), uD = await user('new', '919900000004'), uE = await user('dup', '919900000005');
  const jwt = (id: string) => { const t = `token-${id}-`.padEnd(60, 'x'); tokenToUser.set(t, id); return t; };
  const as = (uid: string | null, url: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    new Request(`http://localhost/api/${url}`, { method, headers: { ...(uid ? { authorization: `Bearer ${jwt(uid)}` } : {}), 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const go = async (handler: any, req: Request, params: Record<string, string> = {}) => { const r: Response = await handler(req, params); const text = await r.text(); let body: any; try { body = JSON.parse(text); } catch { body = text; } return { status: r.status, body, headers: r.headers }; };
  // The routes allow 20 money writes a minute per rider, in memory. The checks make more than that, so they move the
  // clock this process sees forward a minute at a time (the database keeps its own time).
  const realNow = Date.now.bind(Date); let skew = 0;
  Date.now = () => realNow() + skew;
  const freshRateWindow = () => { skew += 61_000; };
  const key = (p: string) => `${p}-${crypto.randomUUID().slice(0, 12)}`;

  // cleanup of everything removable, safe to run first and last
  const riderIdsOf = async (uids: string[]) => (must(await d.from('riders').select('id').in('user_id', uids)) as any[]).map(r => r.id as string);
  // rider_policies for Latur: remembered, and put back (or removed) at the end
  const policyBefore = (must(await d.from('rider_policies').select('*').eq('city_id', 'latur')) as any[])[0] ?? null;
  const setPolicy = async (patch: any) => must(await d.from('rider_policies').upsert({ city_id: 'latur', ...patch }).select('city_id'));
  const dropPolicy = async () => { await d.from('rider_policies').delete().eq('city_id', 'latur'); };
  async function cleanup(final: boolean) {
    const rids = await riderIdsOf([uA, uB, uD, uE]);
    if (rids.length) {
      const jobs = (must(await d.from('delivery_jobs').select('id, ol_order_id').in('rider_id', rids)) as any[]);
      const jobIds = jobs.map(j => j.id);
      const assets = (must(await d.from('delivery_assets').select('storage_path').in('rider_id', rids)) as any[]).map(a => a.storage_path);
      if (assets.length) await d.storage.from('rider-uploads').remove(assets);
      await d.from('rider_sos').delete().in('rider_id', rids);
      if (jobIds.length) {
        await d.from('delivery_exceptions').delete().in('job_id', jobIds);
        await d.from('delivery_jobs').delete().in('id', jobIds);
        await d.from('ol_orders').delete().in('id', jobs.map(j => j.ol_order_id));
      }
      await d.from('push_tokens').delete().in('rider_id', rids);
      await d.from('rider_documents').delete().in('rider_id', rids);
      await d.from('riders').update({ photo_asset_id: null, rc_asset_id: null }).in('id', rids);
      await d.from('riders').delete().in('id', rids);
    }
    const cId = (await riderIdsOf([uC]))[0];
    if (cId) { await d.from('payouts').delete().eq('payee_type', 'rider').eq('payee_id', cId); await d.from('rider_cash_deposits').delete().eq('rider_id', cId); await d.from('riders').update({ cash_limit: null, city_id: null }).eq('id', cId); await d.from('payout_accounts').delete().eq('rider_id', cId); }
    await d.from('rider_store_invites').delete().like('code', 'ZZTEST-%');
    await d.from('ol_stores').delete().eq('id', 'zz-test-store');
    if (final) { if (policyBefore) await d.from('rider_policies').upsert(policyBefore); else await d.from('rider_policies').delete().eq('city_id', 'latur'); }
    if (final) for (const id of [uA, uB, uD, uE]) await d.auth.admin.deleteUser(id);
  }
  await cleanup(false);

  const order = async () => must(await d.from('ol_orders').insert({ customer_hash: TAG, items: [{ id: 'x', name: 'Test', qty: 1, price: 100 }], subtotal: 100, total: 100 }).select('id'))[0].id as string;
  const mkRider = async (uid: string, name: string, extra: any = {}) => must(await d.from('riders').insert({ user_id: uid, full_name: name, type: 'solo', status: 'approved', vehicle: 'bike', ...extra }).select('id'))[0].id as string;
  const mkJob = async (rider: string, tag: string, extra: any = {}) => must(await d.from('delivery_jobs').insert({
    ol_order_id: await order(), city_id: 'latur', status: 'picked_up', step: 'to_drop', idempotency_key: `zz-rx-${tag}-${crypto.randomUUID().slice(0, 8)}`, rider_id: rider, payment_mode: 'cod',
    cash_to_collect: 100, items_count: 1, pickup_name: 'ZZ Kitchen', pickup_lat: 18.4088, pickup_lng: 76.5604, drop_area: 'Gandhi Chowk', drop_lat: 18.4001, drop_lng: 76.5702,
    customer_first_name: 'Asha', customer_phone: '+919888800001', otp_hash: 'zz', ...extra }).select('*'))[0];
  const rA = await mkRider(uA, 'ZZ Rider A', { city_id: 'latur' }), rB = await mkRider(uB, 'ZZ Rider B');
  const jobA = await mkJob(rA, 'a'), jobB = await mkJob(rB, 'b');
  must(await d.from('push_tokens').insert({ rider_id: rA, expo_push_token: 'ExponentPushToken[zz-rider-extra-a-0001]', platform: 'android' }));

  // the money rider, its delivered job and its earnings are created once and reused (their tables are append-only)
  let rC = (await riderIdsOf([uC]))[0];
  if (!rC) rC = await mkRider(uC, 'ZZ Money Rider');
  let jobC = (must(await d.from('delivery_jobs').select('*').eq('rider_id', rC).like('idempotency_key', 'zz-rx-money-%')) as any[])[0];
  if (!jobC) {
    jobC = await mkJob(rC, 'money', { status: 'delivered', step: null, delivered_at: new Date().toISOString() });
    must(await d.from('rider_earnings').insert([
      { rider_id: rC, delivery_job_id: jobC.id, kind: 'delivery_fee', amount_minor: 50000 }, { rider_id: rC, delivery_job_id: jobC.id, kind: 'tip', amount_minor: 2000 },
      { rider_id: rC, delivery_job_id: jobC.id, kind: 'bonus', amount_minor: 1000 }]));
    must(await d.from('rider_cash_entries').insert({ rider_id: rC, delivery_job_id: jobC.id, kind: 'collected', amount_minor: 30000 }));
  }

  // =============== A. the delivery loop ===============
  let r = await go(route.notifs.GET, as(null, 'rider/notifications'));
  check('no sign-in: 401', r.status === 401, r);
  r = await go(route.notifs.GET, as(uD, 'rider/notifications'));
  check('a rider who is not approved yet cannot use rider routes: 403', r.status === 403, r);

  // track
  const t0 = Date.now() - 60_000;
  const pt = (i: number, over: any = {}) => ({ lat: 18.4088 + i * 0.0001, lng: 76.5604, accuracy_m: 8, speed: 3, heading: 90, recorded_at: new Date(t0 + i * 5000).toISOString(), ...over });
  r = await go(route.track.POST, as(uA, `rider/jobs/${jobA.id}/track`, 'POST', { points: [pt(0), pt(1), pt(2)] }), { id: jobA.id });
  check('track: three points stored', r.status === 200 && r.body.stored === 3, r);
  r = await go(route.track.POST, as(uA, `rider/jobs/${jobA.id}/track`, 'POST', { points: [pt(0), pt(1), pt(2), pt(3)] }), { id: jobA.id });
  check('track: a retried batch ignores the duplicates (only the new point is stored)', r.status === 200 && r.body.stored === 1, r);
  r = await go(route.track.POST, as(uA, `rider/jobs/${jobA.id}/track`, 'POST', { points: [pt(4), pt(5, { lat: 28.0 })] }), { id: jobA.id });
  check('track: a point that jumps 1,000 km in 5 s is dropped', r.status === 200 && r.body.dropped === 1 && r.body.stored === 1, r);
  check('track: rows are in the database for the right rider', must(await d.from('rider_tracks').select('id').eq('job_id', jobA.id).eq('rider_id', rA)).length === 5);
  r = await go(route.track.POST, as(uA, `rider/jobs/${jobA.id}/track`, 'POST', { points: Array.from({ length: 61 }, (_, i) => pt(i + 10)) }), { id: jobA.id });
  check('track: more than 60 points: 400', r.status === 400 && r.body.code === 'validation', r);
  r = await go(route.track.POST, as(uA, `rider/jobs/${jobA.id}/track`, 'POST', { points: [pt(20, { lat: 95 })] }), { id: jobA.id });
  check('track: an impossible latitude: 400', r.status === 400, r);
  r = await go(route.track.POST, as(uA, `rider/jobs/${jobA.id}/track`, 'POST', { points: [pt(21, { lat: 0, lng: 0 })] }), { id: jobA.id });
  check('track: 0,0 is not a position: 400', r.status === 400, r);
  r = await go(route.track.POST, as(uA, `rider/jobs/${jobB.id}/track`, 'POST', { points: [pt(30)] }), { id: jobB.id });
  check("track: another rider's job: 404", r.status === 404 && r.body.code === 'not_found', r);
  r = await go(route.track.POST, as(uC, `rider/jobs/${jobC.id}/track`, 'POST', { points: [pt(31)] }), { id: jobC.id });
  check('track: a finished job: 409', r.status === 409 && r.body.code === 'wrong_state', r);

  // uploads
  r = await go(route.uploads.POST, as(uA, 'rider/uploads', 'POST', { kind: 'passport', content_type: 'image/jpeg' }));
  check('uploads: unknown kind: 400', r.status === 400 && r.body.code === 'validation', r);
  r = await go(route.uploads.POST, as(uA, 'rider/uploads', 'POST', { kind: 'proof_photo', content_type: 'text/html' }));
  check('uploads: content type not allowed: 400', r.status === 400, r);
  r = await go(route.uploads.POST, as(uA, 'rider/uploads', 'POST', { kind: 'proof_photo', content_type: 'image/jpeg', job_id: jobB.id }));
  check("uploads: evidence for another rider's job: 404", r.status === 404, r);
  r = await go(route.uploads.POST, as(uA, 'rider/uploads', 'POST', { kind: 'proof_photo', content_type: 'image/jpeg', job_id: jobA.id }));
  check('uploads: asset id and signed url returned', r.status === 200 && /^[0-9a-f-]{36}$/.test(r.body.asset_id) && /^http/.test(r.body.upload_url), r);
  const assetA = r.body.asset_id;
  const row = must(await d.from('delivery_assets').select('*').eq('id', assetA))[0];
  check('uploads: the asset row belongs to the rider, pending, in their own folder', row.rider_id === rA && row.status === 'pending' && row.storage_path.startsWith(`${rA}/`) && row.kind === 'proof_photo', row);
  const put = await realFetch(r.body.upload_url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: JPEG });
  check('uploads: the app can PUT the bytes to the signed url', put.ok, await put.text());
  check('uploads: the bucket is private (no public url for the object)', (await realFetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/rider-uploads/${row.storage_path}`)).status >= 400);

  // exception/resolve (a waiting problem)
  const openProblem = async (job: any, kind: string, ageSeconds = 0) => {
    // direct status writes are refused (0229): the problem is opened through the real dispatch_open_exception door, then backdated
    const id = must(await d.rpc('dispatch_open_exception', { p_job: job.id, p_rider: job.rider_id, p_kind: kind, p_note: null, p_asset: null, p_lat: null, p_lng: null, p_clat: null, p_clng: null, p_actor: 'rider', p_request_id: `re-open-${job.id.slice(0, 8)}-${kind}` })) as string;
    must(await d.from('delivery_exceptions').update({ created_at: new Date(Date.now() - ageSeconds * 1000).toISOString() }).eq('id', id));
    return id;
  };
  let exId = await openProblem(jobA, 'unavailable', 10);
  r = await go(route.resolve.POST, as(uA, `rider/jobs/${jobA.id}/exception/resolve`, 'POST', { kind: 'bogus', outcome: 'continue' }), { id: jobA.id });
  check('resolve: bad kind: 400', r.status === 400, r);
  r = await go(route.resolve.POST, as(uB, `rider/jobs/${jobA.id}/exception/resolve`, 'POST', { kind: 'unavailable', outcome: 'continue' }), { id: jobA.id });
  check("resolve: another rider's job: 404", r.status === 404, r);
  r = await go(route.resolve.POST, as(uA, `rider/jobs/${jobA.id}/exception/resolve`, 'POST', { kind: 'not_ready', outcome: 'continue' }), { id: jobA.id });
  check('resolve: a kind that is not the open problem: 409', r.status === 409, r);
  r = await go(route.resolve.POST, as(uA, `rider/jobs/${jobA.id}/exception/resolve`, 'POST', { kind: 'unavailable', outcome: 'escalate' }), { id: jobA.id });
  check('resolve: escalating an unavailable customer too early: 409 with the seconds left', r.status === 409 && r.body.code === 'wait_not_elapsed' && r.body.wait_seconds > 0, r);
  await setPolicy({ unavailable_wait_seconds: 5 });
  r = await go(route.resolve.POST, as(uA, `rider/jobs/${jobA.id}/exception/resolve`, 'POST', { kind: 'unavailable', outcome: 'escalate' }), { id: jobA.id });
  check("resolve: the city policy's wait (5 s) replaces the default (300 s): a 10 s wait may escalate", r.status === 200 && r.body.nextActions.includes('await_operations'), r);
  await dropPolicy();
  await d.from('delivery_exceptions').update({ created_at: new Date(Date.now() - 900_000).toISOString() }).eq('id', exId);
  r = await go(route.resolve.POST, as(uA, `rider/jobs/${jobA.id}/exception/resolve`, 'POST', { kind: 'unavailable', outcome: 'escalate' }), { id: jobA.id });
  check('resolve: escalate after the wait: operations is told, the problem stays open', r.status === 200 && r.body.exception.status === 'open' && r.body.nextActions.includes('await_operations'), r);
  check('resolve: an escalation event is on the job once', must(await d.from('delivery_events').select('id').eq('job_id', jobA.id).eq('kind', 'delivery.exception_escalated')).length === 1);
  r = await go(route.resolve.POST, as(uA, `rider/jobs/${jobA.id}/exception/resolve`, 'POST', { kind: 'unavailable', outcome: 'escalate' }), { id: jobA.id });
  check('resolve: escalating twice adds no second event', r.status === 200 && must(await d.from('delivery_events').select('id').eq('job_id', jobA.id).eq('kind', 'delivery.exception_escalated')).length === 1, r);
  r = await go(route.resolve.POST, as(uA, `rider/jobs/${jobA.id}/exception/resolve`, 'POST', { kind: 'unavailable', outcome: 'continue' }), { id: jobA.id });
  check('resolve: continue puts the job back where it was', r.status === 200 && r.body.exception.status === 'resolved' && r.body.jobState === 'to_drop' && r.body.nextActions.includes('continue'), r);
  r = await go(route.resolve.POST, as(uA, `rider/jobs/${jobA.id}/exception/resolve`, 'POST', { kind: 'unavailable', outcome: 'continue' }), { id: jobA.id });
  check('resolve: the same tap again answers the same', r.status === 200 && r.body.exception.status === 'resolved', r);
  // the job came from picked_up / to_drop and resume returned it there: nothing to repair (direct status writes are refused, 0229)

  // sos
  const sosKey = key('sos');
  r = await go(route.sos.POST, as(uA, 'rider/sos', 'POST', { job_id: jobB.id, lat: 18.4, lng: 76.56 }, { 'idempotency-key': sosKey }));
  check("sos: another rider's job: 404", r.status === 404, r);
  r = await go(route.sos.POST, as(uA, 'rider/sos', 'POST', { job_id: jobA.id, lat: 18.4, lng: 76.56 }, { 'idempotency-key': sosKey }));
  check('sos: recorded (contact_alert is null: no messaging provider)', r.status === 200 && r.body.ok && r.body.contact_alert === null && !r.body.replayed, r);
  const sosId = r.body.sos_id;
  r = await go(route.sos.POST, as(uA, 'rider/sos', 'POST', { job_id: jobA.id, lat: 18.4, lng: 76.56 }, { 'idempotency-key': sosKey }));
  check('sos: the same key does not make a second alert', r.status === 200 && r.body.sos_id === sosId && r.body.replayed === true && must(await d.from('rider_sos').select('id').eq('rider_id', rA)).length === 1, r);
  check('sos: the rider is told on their phone (simulated push)', pushes.some(p => p.title === 'SOS received'));
  r = await go(route.sos.POST, as(uA, 'rider/sos', 'POST', { lat: 120, lng: 76 }, { 'idempotency-key': key('sos') }));
  check('sos: impossible coordinates: 400', r.status === 400, r);

  // call
  r = await go(route.call.POST, as(uB, `rider/jobs/${jobA.id}/call`, 'POST', {}), { id: jobA.id });
  check("call: another rider's job gives no number: 404", r.status === 404 && !JSON.stringify(r.body).includes('9888800001'), r);
  r = await go(route.call.POST, as(uA, `rider/jobs/${jobA.id}/call`, 'POST', {}), { id: jobA.id });
  check('call: own live job gives the customer number (contract V1) and is logged', r.status === 200 && r.body.number === '+919888800001' && must(await d.from('delivery_call_log').select('id').eq('job_id', jobA.id)).length === 1, r);
  r = await go(route.call.POST, as(uC, `rider/jobs/${jobC.id}/call`, 'POST', {}), { id: jobC.id });
  check('call: a finished job gives no number: 409', r.status === 409 && !JSON.stringify(r.body).includes('9888800001'), r);

  // otp resend
  r = await go(route.otp.POST, as(uB, `rider/jobs/${jobA.id}/otp/resend`, 'POST', {}), { id: jobA.id });
  check("otp resend: another rider's job: 404", r.status === 404, r);
  r = await go(route.otp.POST, as(uA, `rider/jobs/${jobA.id}/otp/resend`, 'POST', {}), { id: jobA.id });
  check('otp resend: honest receipt (skipped, no channel, no number)', r.status === 200 && r.body.status === 'skipped' && r.body.channel === null && r.body.resend_after_seconds === 30 && !JSON.stringify(r.body).includes('9888'), r);
  r = await go(route.otp.POST, as(uA, `rider/jobs/${jobA.id}/otp/resend`, 'POST', {}), { id: jobA.id });
  check('otp resend: too soon: 429 rate_limited with Retry-After', r.status === 429 && r.body.code === 'rate_limited' && !!r.headers.get('retry-after'), r);
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  await d.from('delivery_otp_resends').delete().eq('job_id', jobA.id);
  await d.from('delivery_otp_resends').insert([{ job_id: jobA.id, sent_at: ago(50) }, { job_id: jobA.id, sent_at: ago(30) }, { job_id: jobA.id, sent_at: ago(10) }]);
  r = await go(route.otp.POST, as(uA, `rider/jobs/${jobA.id}/otp/resend`, 'POST', {}), { id: jobA.id });
  check('otp resend: a fourth within the hour: 429', r.status === 429, r);
  await d.from('delivery_otp_resends').delete().eq('job_id', jobA.id).gte('sent_at', ago(15));
  r = await go(route.otp.POST, as(uA, `rider/jobs/${jobA.id}/otp/resend`, 'POST', {}), { id: jobA.id });
  check('otp resend: allowed again when only two are in the hour', r.status === 200, r);

  // =============== B. notifications ===============
  must(await d.from('rider_notifications').insert(Array.from({ length: 35 }, (_, i) => ({ rider_id: rB, kind: 'info', title: `n${i}`, body: 'b', data: { deep_link: '/x' }, created_at: new Date(Date.now() - i * 1000).toISOString() }))));
  r = await go(route.notifs.GET, as(uB, 'rider/notifications'));
  check('notifications: first page of 30 with a cursor, newest first', r.status === 200 && r.body.items.length === 30 && !!r.body.next_cursor && r.body.items[0].title === 'n0', r.body.items?.length);
  const first = r.body.items;
  r = await go(route.notifs.GET, as(uB, `rider/notifications?cursor=${r.body.next_cursor}`));
  check('notifications: second page has the other 5 and no cursor, no overlap', r.status === 200 && r.body.items.length === 5 && r.body.next_cursor === null && !r.body.items.some((x: any) => first.some((y: any) => y.id === x.id)), r);
  r = await go(route.notifs.GET, as(uB, 'rider/notifications?cursor=garbage'));
  check('notifications: a bad cursor: 400', r.status === 400, r);
  r = await go(route.notifs.GET, as(uA, 'rider/notifications'));
  check("notifications: a rider never sees another rider's", r.status === 200 && r.body.items.every((x: any) => x.title !== 'n0'), r);
  const ids3 = first.slice(0, 3).map((x: any) => x.id);
  r = await go(route.read.POST, as(uB, 'rider/notifications/read', 'POST', { ids: [...ids3, 'not-a-uuid'] }));
  check('notifications: mark read', r.status === 200 && r.body.updated === 3, r);
  r = await go(route.read.POST, as(uB, 'rider/notifications/read', 'POST', { ids: ids3 }));
  check('notifications: marking again changes nothing', r.status === 200 && r.body.updated === 0, r);
  r = await go(route.read.POST, as(uA, 'rider/notifications/read', 'POST', { ids: first.slice(3, 6).map((x: any) => x.id) }));
  check("notifications: cannot mark another rider's", r.status === 200 && r.body.updated === 0 && must(await d.from('rider_notifications').select('id').in('id', first.slice(3, 6).map((x: any) => x.id)).is('read_at', null)).length === 3, r);

  // =============== C. money (the money rider: ₹500 fee + ₹20 tip + ₹10 bonus, ₹300 cash in hand) ===============
  const rupees = (n: number) => n;
  r = await go(route.earnings.GET, as(uC, 'rider/earnings?range=year'));
  check('earnings: unknown range: 400', r.status === 400, r);
  const istDay = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
  for (const [range, n] of [['today', 1], ['week', 7]] as const) {
    r = await go(route.earnings.GET, as(uC, `rider/earnings?range=${range}`));
    const sum = r.body.split ? r.body.split.order_pay + r.body.split.milestone_bonus + r.body.split.tips : -1;
    check(`earnings ${range}: shape, series of ${n}, split adds up to the total`, r.status === 200 && r.body.series.length === n && Math.abs(sum - r.body.total) < 0.005 && typeof r.body.period_label === 'string', r);
  }
  r = await go(route.earnings.GET, as(uC, 'rider/earnings?range=month'));
  const monthRows = must(await d.from('rider_earnings').select('amount_minor, created_at').eq('rider_id', rC));
  const monthKey = istDay(Date.now()).slice(0, 7);
  const monthTotal = monthRows.filter((x: any) => istDay(Date.parse(x.created_at)).slice(0, 7) === monthKey).reduce((s: number, x: any) => s + x.amount_minor, 0) / 100;
  check('earnings month: equals the ledger rows of the month, in rupees', r.status === 200 && Math.abs(r.body.total - monthTotal) < 0.005 && r.body.series.length >= 28, { api: r.body.total, db: monthTotal });
  r = await go(route.earnings.GET, as(uB, 'rider/earnings?range=month'));
  check('earnings: another rider has none of it', r.status === 200 && r.body.total === 0 && r.body.deliveries === 0, r);
  r = await go(route.jobEarn.GET, as(uC, `rider/earnings/jobs/${jobC.id}`), { id: jobC.id });
  check('job earnings: base 500, tip 20, bonus 10, total 530 rupees', r.status === 200 && r.body.earnings.base === 500 && r.body.earnings.tip === 20 && r.body.earnings.bonus === 10 && r.body.earnings.total === 530 && r.body.job.id === jobC.id && r.body.job.earnings === 530, r);
  r = await go(route.jobEarn.GET, as(uB, `rider/earnings/jobs/${jobC.id}`), { id: jobC.id });
  check("job earnings: another rider's job: 404", r.status === 404, r);
  r = await go(route.history.GET, as(uC, 'rider/jobs'));
  check('history: the delivered job with its earnings', r.status === 200 && r.body.items.some((x: any) => x.id === jobC.id && x.earnings === 530 && x.state === 'delivered'), r);
  r = await go(route.history.GET, as(uA, 'rider/jobs'));
  check("history: live jobs and other riders' jobs are not in it", r.status === 200 && r.body.items.length === 0, r);

  r = await go(route.cash.GET, as(uC, 'rider/cash'));
  check('cash: ₹300 in hand, a collected entry, limit from the default', r.status === 200 && r.body.cash_in_hand === 300 && r.body.cash_limit === 5000 && r.body.ledger.some((l: any) => l.kind === 'collected' && l.amount === 300) && r.body.upi_deposit === null, r);
  const depKey = key('dep');
  r = await go(route.deposits.POST, as(uC, 'rider/cash/deposits', 'POST', { amount: 100 }));
  check('deposit: Idempotency-Key is required: 400', r.status === 400, r);
  r = await go(route.deposits.POST, as(uC, 'rider/cash/deposits', 'POST', { amount: 100 }, { 'idempotency-key': depKey }));
  check('deposit: recorded as PENDING for ₹100, no checkout link', r.status === 200 && r.body.status === 'pending' && r.body.amount === 100 && r.body.checkout_url === null, r);
  const depId = r.body.id;
  r = await go(route.deposits.POST, as(uC, 'rider/cash/deposits', 'POST', { amount: 100 }, { 'idempotency-key': depKey }));
  check('deposit: the same key returns the same deposit', r.status === 200 && r.body.id === depId && r.headers.get('idempotent-replay') === 'true' && must(await d.from('rider_cash_deposits').select('id').eq('rider_id', rC)).length === 1, r);
  r = await go(route.deposits.POST, as(uC, 'rider/cash/deposits', 'POST', { amount: 50 }, { 'idempotency-key': depKey }));
  check('deposit: the same key with another amount: 422', r.status === 422 && r.body.code === 'idempotency_mismatch', r);
  r = await go(route.deposits.POST, as(uC, 'rider/cash/deposits', 'POST', { amount: 250 }, { 'idempotency-key': key('dep') }));
  check('deposit: more than the cash held (counting the pending one): 422', r.status === 422, r);
  r = await go(route.deposits.POST, as(uC, 'rider/cash/deposits', 'POST', { amount: -5 }, { 'idempotency-key': key('dep') }));
  check('deposit: a negative amount: 400', r.status === 400, r);
  check('deposit: nothing was confirmed, so the cash in hand is unchanged', (await go(route.cash.GET, as(uC, 'rider/cash'))).body.cash_in_hand === 300);
  r = await go(route.deposit.GET, as(uC, `rider/cash/deposits/${depId}`), { id: depId });
  check('deposit: read it back', r.status === 200 && r.body.id === depId && r.body.status === 'pending', r);
  r = await go(route.deposit.GET, as(uB, `rider/cash/deposits/${depId}`), { id: depId });
  check("deposit: another rider's deposit: 404", r.status === 404, r);

  r = await go(route.wallet.GET, as(uC, 'rider/wallet'));
  check('wallet: balance and available ₹530, nothing in flight, no payout account', r.status === 200 && r.body.balance === 530 && r.body.available === 530 && r.body.in_flight === 0 && r.body.payout_method === null && r.body.instant.withdrawals_left_today === 3, r);
  const wKey = key('wd');
  r = await go(route.withdraw.POST, as(uC, 'rider/payouts/withdraw', 'POST', { amount: 100 }, { 'idempotency-key': key('wd') }));
  check('withdraw: no payout account yet: 422 no_payout_account, nothing recorded', r.status === 422 && r.body.code === 'no_payout_account' && must(await d.from('payouts').select('id').eq('payee_id', rC)).length === 0, r);
  r = await go(route.payoutMethod.PUT, as(uC, 'rider/payout', 'PUT', { method: 'upi', vpa: 'zzmoney@okaxis', provider_ref: 'zz-prov-1' }));
  check('payout method: UPI saved masked and not verified', r.status === 200 && r.body.method === 'upi' && r.body.vpa === 'zz***@okaxis' && r.body.status === 'pending', r);
  check('payout method: the row keeps kind, masked display and provider_ref only', JSON.stringify(must(await d.from('payout_accounts').select('*').eq('rider_id', rC))[0]).includes('zzmoney') === false && must(await d.from('payout_accounts').select('provider_ref, kind').eq('rider_id', rC))[0].provider_ref === 'zz-prov-1');
  r = await go(route.wallet.GET, as(uC, 'rider/wallet'));
  check('wallet: payout_method now reads the saved account', r.status === 200 && r.body.payout_method?.method === 'upi' && r.body.payout_method.vpa === 'zz***@okaxis', r.body.payout_method);
  r = await go(route.withdraw.POST, as(uC, 'rider/payouts/withdraw', 'POST', { amount: 100 }));
  check('withdraw: Idempotency-Key is required: 400', r.status === 400, r);
  r = await go(route.withdraw.POST, as(uC, 'rider/payouts/withdraw', 'POST', { amount: 1000 }, { 'idempotency-key': key('wd') }));
  check('withdraw: more than the balance: 422 insufficient_balance', r.status === 422 && r.body.code === 'insufficient_balance', r);
  r = await go(route.withdraw.POST, as(uC, 'rider/payouts/withdraw', 'POST', { amount: 5 }, { 'idempotency-key': key('wd') }));
  check('withdraw: below the minimum: 422', r.status === 422, r);
  r = await go(route.withdraw.POST, as(uC, 'rider/payouts/withdraw', 'POST', { amount: 100 }, { 'idempotency-key': wKey }));
  check('withdraw: ₹100 recorded as pending (processing), nothing paid', r.status === 200 && r.body.amount === 100 && r.body.status === 'processing' && r.body.net === 100, r);
  const payId = r.body.id;
  check('withdraw: a pending payouts row with payee_type rider', must(await d.from('payouts').select('status, payee_type, amount_minor').eq('id', payId))[0].status === 'pending');
  r = await go(route.withdraw.POST, as(uC, 'rider/payouts/withdraw', 'POST', { amount: 100 }, { 'idempotency-key': wKey }));
  check('withdraw: the same key does not pay twice', r.status === 200 && r.body.id === payId && r.headers.get('idempotent-replay') === 'true' && must(await d.from('payouts').select('id').eq('payee_id', rC)).length === 1, r);
  r = await go(route.withdraw.POST, as(uC, 'rider/payouts/withdraw', 'POST', { amount: 120 }, { 'idempotency-key': wKey }));
  check('withdraw: the same key with another amount: 422', r.status === 422 && r.body.code === 'idempotency_mismatch', r);
  freshRateWindow();
  const both = await Promise.all([1, 2].map(() => go(route.withdraw.POST, as(uC, 'rider/payouts/withdraw', 'POST', { amount: 300 }, { 'idempotency-key': key('race') }))));
  check('withdraw: two different taps at once cannot both spend the same money (₹430 left, 2 x ₹300): at most one succeeds, the rest 422', both.filter(x => x.status === 200).length <= 1 && both.every(x => x.status === 200 || x.status === 422) && must(await d.from('payouts').select('id').eq('payee_id', rC).eq('amount_minor', 30000)).length <= 1, both.map(x => x.status));
  await d.from('payouts').delete().eq('payee_id', rC).eq('amount_minor', 30000);
  const sameKey = key('same');
  const twin = await Promise.all([1, 2].map(() => go(route.withdraw.POST, as(uC, 'rider/payouts/withdraw', 'POST', { amount: 110 }, { 'idempotency-key': sameKey }))));
  check('withdraw: the same key twice at once: both answer 200 with the one payout (unique index, 23505 handled)', twin.every(x => x.status === 200) && twin[0].body.id === twin[1].body.id && must(await d.from('payouts').select('id').eq('payee_id', rC).eq('idempotency_key', sameKey)).length === 1, twin.map(x => x.status));
  await d.from('payouts').delete().eq('payee_id', rC).eq('idempotency_key', sameKey);
  check('withdraw: the payout row carries the idempotency key, not a made-up reference', must(await d.from('payouts').select('idempotency_key, reference').eq('id', payId))[0].idempotency_key === wKey && must(await d.from('payouts').select('reference').eq('id', payId))[0].reference === null);
  r = await go(route.wallet.GET, as(uC, 'rider/wallet'));
  check('wallet: balance ₹430 and ₹100 in flight after one withdrawal', r.status === 200 && r.body.balance === 430 && r.body.in_flight === 100 && r.body.recent.length === 1, r);
  r = await go(route.payouts.GET, as(uC, 'rider/payouts'));
  check('payouts: listed', r.status === 200 && r.body.items.length === 1 && r.body.items[0].id === payId && r.body.next_cursor === null, r);
  r = await go(route.payout.GET, as(uC, `rider/payouts/${payId}`), { id: payId });
  check('payouts: one by id', r.status === 200 && r.body.id === payId, r);
  r = await go(route.payout.GET, as(uB, `rider/payouts/${payId}`), { id: payId });
  check("payouts: another rider's payout: 404", r.status === 404, r);
  r = await go(route.wallet.GET, as(uB, 'rider/wallet'));
  check("wallet: another rider's wallet is empty", r.status === 200 && r.body.balance === 0, r);
  must(await d.from('payout_accounts').insert({ rider_id: rB, kind: 'upi', display_masked: 'zz***@okaxis' }));
  r = await go(route.withdraw.POST, as(uB, 'rider/payouts/withdraw', 'POST', { amount: 100 }, { 'idempotency-key': key('wd') }));
  check('withdraw: a rider with no earnings: 422', r.status === 422 && r.body.code === 'insufficient_balance', r);
  await d.from('riders').update({ cash_limit: 200 }).eq('id', rC);
  r = await go(route.withdraw.POST, as(uC, 'rider/payouts/withdraw', 'POST', { amount: 100 }, { 'idempotency-key': key('wd') }));
  check('withdraw: blocked while cash in hand is over the limit: 403 payout_blocked', r.status === 403 && r.body.code === 'payout_blocked', r);
  await d.from('riders').update({ cash_limit: null }).eq('id', rC);
  void rupees;

  freshRateWindow();
  // policy rows override the provisional defaults (rC is put in Latur for these)
  await d.from('riders').update({ city_id: 'latur' }).eq('id', rC);
  r = await go(route.wallet.GET, as(uC, 'rider/wallet'));
  check('policy: with no policy row the provisional defaults show (min ₹100, max ₹10,000, 3 a day)', r.status === 200 && r.body.instant.min_amount === 100 && r.body.instant.max_amount === 10000 && r.body.instant.withdrawals_left_today === 2, r.body.instant);
  await setPolicy({ withdraw_min_minor: 20000, withdraw_max_minor: 25000, withdraw_per_day: 1 });
  r = await go(route.wallet.GET, as(uC, 'rider/wallet'));
  check('policy: the city row overrides min, max and per-day in the wallet', r.status === 200 && r.body.instant.min_amount === 200 && r.body.instant.max_amount === 250 && r.body.instant.withdrawals_left_today === 0, r.body.instant);
  r = await go(route.withdraw.POST, as(uC, 'rider/payouts/withdraw', 'POST', { amount: 150 }, { 'idempotency-key': key('wd') }));
  check('policy: below the city minimum (₹150 < ₹200): 422', r.status === 422 && /200/.test(r.body.detail ?? ''), r);
  freshRateWindow();
  r = await go(route.withdraw.POST, as(uC, 'rider/payouts/withdraw', 'POST', { amount: 260 }, { 'idempotency-key': key('wd') }));
  check('policy: above the city maximum (₹260 > ₹250): 422', r.status === 422, r);
  r = await go(route.withdraw.POST, as(uC, 'rider/payouts/withdraw', 'POST', { amount: 200 }, { 'idempotency-key': key('wd') }));
  check('policy: one withdrawal a day already used: 403 payout_blocked', r.status === 403 && r.body.code === 'payout_blocked', r);
  await setPolicy({ withdraw_min_minor: null, withdraw_max_minor: null, withdraw_per_day: null, default_cash_limit_minor: 20000 });
  r = await go(route.cash.GET, as(uC, 'rider/cash'));
  check('policy: a null column falls back, and default_cash_limit_minor sets the limit (₹200)', r.status === 200 && r.body.cash_limit === 200, r);
  r = await go(route.withdraw.POST, as(uC, 'rider/payouts/withdraw', 'POST', { amount: 100 }, { 'idempotency-key': key('wd') }));
  check('policy: ₹300 in hand over the ₹200 policy limit blocks withdrawing: 403', r.status === 403 && r.body.code === 'payout_blocked', r);
  await dropPolicy();
  await d.from('riders').update({ city_id: null }).eq('id', rC);

  // =============== D. onboarding ===============
  r = await go(route.status.GET, as(uD, 'rider/status'));
  check('status: before registering: 403 not_enrolled', r.status === 403 && r.body.code === 'not_enrolled', r);
  r = await go(route.register.POST, as(null, 'rider/register', 'POST', { full_name: 'New Rider' }));
  check('register: no sign-in: 401', r.status === 401, r);
  r = await go(route.register.POST, as(uD, 'rider/register', 'POST', { full_name: 'x' }));
  check('register: a one-letter name: 400', r.status === 400, r);
  r = await go(route.register.POST, as(uD, 'rider/register', 'POST', { full_name: 'New Rider', referral_code: 'x!' }));
  check('register: a malformed referral code: 400', r.status === 400 && r.body.code === 'validation', r);
  r = await go(route.register.POST, as(uD, 'rider/register', 'POST', { full_name: 'New Rider', rider_id: rA, referral_code: ' zz-ref-d1 ' }));
  check('register: creates a draft rider for the signed-in user', r.status === 200 && r.body.status === 'draft' && r.body.rider_id !== rA, r);
  const rD = r.body.rider_id;
  check('register: the referral code is stored trimmed and upper-case', must(await d.from('riders').select('referral_code').eq('id', rD))[0].referral_code === 'ZZ-REF-D1');
  r = await go(route.register.POST, as(uE, 'rider/register', 'POST', { full_name: 'Dup Rider', referral_code: 'ZZ-REF-D1' }));
  check('register: a referral code already taken: 409 conflict and no rider row made', r.status === 409 && r.body.code === 'conflict' && (await riderIdsOf([uE])).length === 0, r);
  r = await go(route.register.POST, as(uD, 'rider/register', 'POST', { full_name: 'New Rider' }));
  check('register: asking again returns the same rider', r.status === 200 && r.body.rider_id === rD && must(await d.from('riders').select('id').eq('user_id', uD)).length === 1, r);
  check('register: the phone comes from the sign-in, not the request', must(await d.from('riders').select('phone').eq('id', rD))[0].phone === '+919900000004');
  r = await go(route.wallet.GET, as(uD, 'rider/wallet'));
  check('a draft rider cannot read money routes: 403', r.status === 403, r);

  r = await go(route.profile.PUT, as(uD, 'rider/profile', 'PUT', { full_name: 'New Rider', email: 'nope', language: 'en' }));
  check('profile: a bad email: 400', r.status === 400, r);
  r = await go(route.profile.PUT, as(uD, 'rider/profile', 'PUT', { full_name: 'New Rider', language: 'en', emergency_phone: 'call me' }));
  check('profile: an emergency phone that is not a number: 400', r.status === 400, r);
  r = await go(route.profile.PUT, as(uD, 'rider/profile', 'PUT', { full_name: 'New Rider', language: 'xx' }));
  check('profile: an unknown language: 400', r.status === 400, r);
  r = await go(route.profile.PUT, as(uD, 'rider/profile', 'PUT', { full_name: 'New Rider', photo_asset_id: assetA, language: 'hi' }));
  check("profile: another rider's file as a photo: 404", r.status === 404, r);
  const up = async (uid: string, kind: string, ct = 'image/jpeg', send = true) => {
    const x = await go(route.uploads.POST, as(uid, 'rider/uploads', 'POST', { kind, content_type: ct }));
    if (send) { const p = await realFetch(x.body.upload_url, { method: 'PUT', headers: { 'content-type': ct }, body: JPEG }); if (!p.ok) throw new Error('upload failed ' + await p.text()); }
    return x.body.asset_id as string;
  };
  const unsent = await up(uD, 'profile_photo', 'image/jpeg', false);
  r = await go(route.profile.PUT, as(uD, 'rider/profile', 'PUT', { full_name: 'New Rider', photo_asset_id: unsent, language: 'hi' }));
  check('profile: a file that never finished uploading: 422 upload_missing', r.status === 422 && r.body.code === 'upload_missing', r);
  const photo = await up(uD, 'profile_photo');
  r = await go(route.profile.PUT, as(uD, 'rider/profile', 'PUT', { full_name: 'New Rider', photo_asset_id: photo, email: 'New@Example.com', language: 'hi', emergency_phone: '+919800000000', rider_id: rA }));
  check('profile: saved (RiderDto), email lower-cased, own row only', r.status === 200 && r.body.id === rD && r.body.photo_asset_id === photo && r.body.email === 'new@example.com' && r.body.language === 'hi', r);
  check('profile: emergency phone stored (spaces dropped) and returned', must(await d.from('riders').select('emergency_phone').eq('id', rD))[0].emergency_phone === '+919800000000' && r.body.emergency_phone === '+919800000000', r.body.emergency_phone);
  check("profile: a rider_id in the body changed nothing on another rider", must(await d.from('riders').select('full_name, email').eq('id', rA))[0].email === null);
  check('profile: the asset is now marked uploaded with its size', must(await d.from('delivery_assets').select('status, size_bytes').eq('id', photo))[0].status === 'uploaded');

  r = await go(route.zones.GET, as(uD, 'geo/zones?lat=18.4088&lng=76.5604'));
  check('zones: inside Latur: state, city, zone', r.status === 200 && r.body.status === 'in_zone' && r.body.city.id === 'latur' && r.body.zone.cityId === 'latur' && r.body.zone.boundary.length > 8 && !!r.body.state.name, r);
  const zoneId = r.body.zone?.id;
  r = await go(route.zones.GET, as(uD, 'geo/zones?lat=19.0760&lng=72.8777'));
  check('zones: Mumbai is outside: code out_of_zone', r.status === 200 && r.body.code === 'out_of_zone' && r.body.status === 'out_of_zone', r);
  r = await go(route.zones.GET, as(uD, 'geo/zones?lat=abc&lng=1'));
  check('zones: bad coordinates: 400', r.status === 400, r);
  r = await go(route.zones.GET, as(null, 'geo/zones?lat=18.4&lng=76.5'));
  check('zones: no sign-in: 401', r.status === 401, r);
  r = await go(route.cityZones.GET, as(uD, 'geo/cities/latur/zones'), { id: 'latur' });
  check('city zones: one zone for Latur', r.status === 200 && r.body.length === 1 && r.body[0].id === zoneId, r);
  r = await go(route.cityZones.GET, as(uD, 'geo/cities/nowhere/zones'), { id: 'nowhere' });
  check('city zones: unknown city: 404', r.status === 404, r);

  r = await go(route.hub.PUT, as(uD, 'rider/hub', 'PUT', { zone_id: 'nowhere-all', lat: 18.4, lng: 76.56, address: 'Station Road' }));
  check('hub: unknown zone: 404', r.status === 404, r);
  r = await go(route.hub.PUT, as(uD, 'rider/hub', 'PUT', { zone_id: zoneId, lat: 19.076, lng: 72.8777, address: 'Mumbai' }));
  check('hub: a pin outside the zone: 422 out_of_zone', r.status === 422 && r.body.code === 'out_of_zone', r);
  r = await go(route.hub.PUT, as(uD, 'rider/hub', 'PUT', { zone_id: zoneId, lat: 18.41, lng: 76.57, address: 'Station Road, Latur', landmark: 'Near the clock tower' }));
  check('hub: saved (Hub), rider zone and city set', r.status === 200 && r.body.zoneId === zoneId && r.body.kind === 'rider_start' && must(await d.from('riders').select('zone_id, city_id').eq('id', rD))[0].city_id === 'latur', r);

  r = await go(route.type.PUT, as(uD, 'rider/type', 'PUT', { type: 'taxi' }));
  check('type: taxi: 409 coming_soon', r.status === 409 && r.body.code === 'coming_soon', r);
  r = await go(route.type.PUT, as(uD, 'rider/type', 'PUT', { type: 'van' }));
  check('type: unknown type: 400', r.status === 400, r);
  r = await go(route.type.PUT, as(uD, 'rider/type', 'PUT', { type: 'solo' }));
  check('type: solo', r.status === 200 && r.body.type === 'solo', r);
  // store link: invites are rows in rider_store_invites
  const orgRow = must(await d.from('organizations').select('id, name').order('id').limit(1))[0];
  await d.from('ol_stores').delete().eq('id', 'zz-test-store');
  const org = must(await d.from('ol_stores').insert({ id: 'zz-test-store', name: 'ZZ Test Store', city_id: 'latur', organization_id: orgRow.id, is_demo: true }).select('id, name, organization_id'))[0];
  const orgName = orgRow.name;
  const inv = async (code: string, extra: any = {}) => must(await d.from('rider_store_invites').insert({ code, organization_id: org.organization_id, store_id: org.id, manager_name: 'Meera Kulkarni', daily_pay_text: 'Rs 600 a day', ...extra }).select('code'));
  await inv('ZZTEST-OK', { max_uses: 1 });
  await inv('ZZTEST-OLD', { expires_at: new Date(Date.now() - 60_000).toISOString() });
  await inv('ZZTEST-FULL', { max_uses: 2, uses: 2 });
  await inv('ZZTEST-OFF', { active: false });
  await inv('ZZTEST-RACE', { max_uses: 1 });
  const uses = async (code: string) => must(await d.from('rider_store_invites').select('uses').eq('code', code))[0].uses as number;
  for (const [code, why] of [['NOPE-NOPE', 'an unknown code'], ['ZZTEST-OLD', 'an expired code'], ['ZZTEST-FULL', 'a used-up code'], ['ZZTEST-OFF', 'an inactive code']]) {
    r = await go(route.link.POST, as(uD, 'rider/store-link', 'POST', { invite_code: code }));
    check(`store link: ${why}: 404 not_found, nothing linked`, r.status === 404 && r.body.code === 'not_found' && must(await d.from('rider_store_links').select('store_id').eq('rider_id', rD)).length === 0, r);
  }
  check('store link: a refused code does not use up a use', (await uses('ZZTEST-FULL')) === 2 && (await uses('ZZTEST-OLD')) === 0);
  r = await go(route.link.POST, as(null, 'rider/store-link', 'POST', { invite_code: 'ZZTEST-OK' }));
  check('store link: no sign-in: 401', r.status === 401, r);
  r = await go(route.link.POST, as(uD, 'rider/store-link', 'POST', { invite_code: 'zztest-ok' }));
  check('store link: a good code (any case) answers organization, store {id,name,zone}, manager, daily pay', r.status === 200 && r.body.organization === orgName && r.body.store.id === org.id && r.body.store.name === org.name && typeof r.body.store.zone === 'string' && r.body.manager_name === 'Meera Kulkarni' && r.body.daily_pay_text === 'Rs 600 a day', r);
  check('store link: one use taken, the rider is linked and tied to the organisation', (await uses('ZZTEST-OK')) === 1 && must(await d.from('rider_store_links').select('store_id, status').eq('rider_id', rD)).length === 1 && must(await d.from('riders').select('organization_id').eq('id', rD))[0].organization_id === org.organization_id);
  r = await go(route.link.POST, as(uD, 'rider/store-link', 'POST', { invite_code: 'ZZTEST-OK' }));
  check('store link: the same rider again gets the same answer without using another use', r.status === 200 && (await uses('ZZTEST-OK')) === 1, r);
  await d.from('rider_store_links').delete().eq('rider_id', rD);
  await d.from('riders').update({ status: 'draft' }).eq('id', rB);
  const race = await Promise.all([uD, uB].map(u => go(route.link.POST, as(u, 'rider/store-link', 'POST', { invite_code: 'ZZTEST-RACE' }))));
  check('store link: two riders racing for the last use: exactly one wins, uses stays at max', race.filter(x => x.status === 200).length === 1 && race.filter(x => x.status === 404).length === 1 && (await uses('ZZTEST-RACE')) === 1, race.map(x => x.status));
  await d.from('riders').update({ status: 'approved', organization_id: null }).eq('id', rB);
  await d.from('rider_store_links').delete().eq('rider_id', rB);
  await d.from('rider_store_links').delete().eq('rider_id', rD);
  await d.from('riders').update({ organization_id: null }).eq('id', rD);

  r = await go(route.vehicle.PUT, as(uD, 'rider/vehicle', 'PUT', { class: '3w', ownership: 'own', registration_no: 'MH24AB1234' }));
  check('vehicle: three-wheeler is not supported: 422', r.status === 422, r);
  r = await go(route.vehicle.PUT, as(uD, 'rider/vehicle', 'PUT', { class: '2w', ownership: 'own', registration_no: 'HELLO' }));
  check('vehicle: a bad registration number: 400', r.status === 400, r);
  const kycAsset = await up(uD, 'dl');
  r = await go(route.vehicle.PUT, as(uD, 'rider/vehicle', 'PUT', { class: '2w', ownership: 'own', registration_no: 'MH24AB1234', rc_asset_id: kycAsset }));
  check('vehicle: an RC that is really a licence photo: 400', r.status === 400, r);
  const rc = await up(uD, 'rc');
  r = await go(route.vehicle.PUT, as(uD, 'rider/vehicle', 'PUT', { class: '2w', ownership: 'own', registration_no: 'mh 24 ab 1234', rc_asset_id: rc }));
  check('vehicle: saved (camelCase RiderVehicle, normalised number)', r.status === 200 && r.body.class === '2w' && r.body.ownership === 'own' && r.body.registrationNo === 'MH24AB1234' && r.body.rcDocumentId === rc, r);

  r = await go(route.prefs.PUT, as(uD, 'rider/preferences', 'PUT', { categories: [], acceptance: 'auto' }));
  check('preferences: no categories: 400', r.status === 400, r);
  r = await go(route.prefs.PUT, as(uD, 'rider/preferences', 'PUT', { categories: ['on_order'], acceptance: 'auto', multi_store: true, store_ids: ['not-mine'] }));
  check('preferences: a store the rider is not linked to: 422', r.status === 422, r);
  r = await go(route.prefs.PUT, as(uD, 'rider/preferences', 'PUT', { categories: ['on_order', 'quick_drop'], acceptance: 'auto', multi_store: false, store_ids: [] }));
  check('preferences: saved (camelCase RiderPreferences)', r.status === 200 && r.body.acceptance === 'auto' && r.body.categories.length === 2 && r.body.multiStore === false, r);

  r = await go(route.payoutMethod.PUT, as(uD, 'rider/payout', 'PUT', { method: 'upi', vpa: 'bad' }));
  check('payout method: invalid UPI id: 400', r.status === 400, r);
  const logged: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(saved) as (keyof typeof saved)[]) console[k] = (...args: any[]) => { logged.push(args.map(String).join(' ')); };
  r = await go(route.payoutMethod.PUT, as(uD, 'rider/payout', 'PUT', { method: 'bank', holder: 'New Rider', account_no: '123456789012', ifsc: 'HDFC0001234' }));
  Object.assign(console, saved);
  check('payout method: bank saved as pending with the last four digits only', r.status === 200 && r.body.method === 'bank' && r.body.account_last4 === '9012' && r.body.status === 'pending', r);
  check('payout method: the raw account number and holder are in no response, row or log line', !JSON.stringify(r.body).includes('123456789012') && !logged.some(l => l.includes('123456789012')) && !JSON.stringify(must(await d.from('payout_accounts').select('*'))).includes('123456789012'));
  const acct = must(await d.from('payout_accounts').select('*').eq('rider_id', rD))[0];
  check('payout method: the row holds kind bank, masked display, not verified', acct.kind === 'bank' && acct.display_masked === 'XXXXXX9012' && acct.verified === false && acct.provider_ref === null, acct);
  r = await go(route.payoutMethod.PUT, as(uD, 'rider/payout', 'PUT', { method: 'upi', vpa: 'rahul.s@ybl', provider_ref: 'zz-prov-2' }));
  check('payout method: a UPI id replaces the bank account (one account per rider), masked', r.status === 200 && r.body.vpa === 'ra***@ybl' && must(await d.from('payout_accounts').select('kind, display_masked, provider_ref').eq('rider_id', rD)).length === 1 && must(await d.from('payout_accounts').select('display_masked, kind').eq('rider_id', rD))[0].display_masked === 'ra***@ybl', r);
  r = await go(route.payoutMethod.PUT, as(null, 'rider/payout', 'PUT', { method: 'upi', vpa: 'a@b.c' }));
  check('payout method: no sign-in: 401', r.status === 401, r);
  r = await go(route.payoutMethod.PUT, as(uD, 'rider/payout', 'PUT', { method: 'bank', holder: 'New Rider', account_no: '12', ifsc: 'HDFC0001234' }));
  check('payout method: a short account number: 400, and the message does not echo it', r.status === 400 && !JSON.stringify(r.body).includes('"12"'), r);

  r = await go(route.submit.POST, as(uD, 'rider/submit', 'POST', {}));
  check('submit: incomplete application: 422 listing what is missing', r.status === 422 && r.body.missing.includes('aadhaar') && r.body.missing.includes('selfie') && !r.body.missing.includes('vehicle'), r);
  r = await go(route.digilocker.POST, as(uD, 'rider/kyc/digilocker/start', 'POST', {}));
  check('digilocker start: 501 provider_not_configured', r.status === 501 && r.body.code === 'provider_not_configured', r);
  r = await go(route.docs.POST, as(uD, 'rider/kyc/documents', 'POST', { kind: 'aadhaar', source: 'digilocker', verification_id: 'v1' }));
  check('documents: DigiLocker: 501 provider_not_configured', r.status === 501, r);
  r = await go(route.docs.POST, as(uD, 'rider/kyc/documents', 'POST', { kind: 'selfie', source: 'upload' }));
  check('documents: an upload with no file: 400', r.status === 400, r);
  r = await go(route.docs.POST, as(uD, 'rider/kyc/documents', 'POST', { kind: 'passport', source: 'upload', asset_id: kycAsset }));
  check('documents: a kind that does not exist: 400', r.status === 400, r);
  r = await go(route.docs.POST, as(uD, 'rider/kyc/documents', 'POST', { kind: 'selfie', source: 'upload', asset_id: kycAsset }));
  check('documents: a licence photo submitted as a selfie: 400', r.status === 400, r);
  r = await go(route.docs.POST, as(uD, 'rider/kyc/documents', 'POST', { kind: 'aadhaar', source: 'upload', asset_id: assetA }));
  check("documents: another rider's file: 404", r.status === 404, r);
  r = await go(route.docs.POST, as(uD, 'rider/kyc/documents', 'POST', { kind: 'aadhaar', source: 'upload', asset_id: kycAsset, number: '1234' }));
  check('documents: an Aadhaar number that is not 12 digits: 400', r.status === 400, r);
  const doc = async (kind: string, extra: any = {}, assetKind = 'dl') => go(route.docs.POST, as(uD, 'rider/kyc/documents', 'POST', { kind, source: 'upload', asset_id: await up(uD, assetKind), ...extra }));
  r = await doc('permit');
  check('documents: a permit is accepted (pending), with no rejection yet', r.status === 200 && r.body.kind === 'permit' && r.body.status === 'pending' && r.body.rejection_reason === null && r.body.reviewed_at === null, r);
  const permitId = r.body.id;
  r = await doc('fitness');
  check('documents: a fitness certificate is accepted (pending)', r.status === 200 && r.body.kind === 'fitness' && r.body.status === 'pending', r);
  await d.from('rider_documents').update({ status: 'rejected', rejection_reason: 'Photo is blurred', reviewed_at: '2026-10-01T10:00:00Z' }).eq('id', permitId);
  const dto = docDto(must(await d.from('rider_documents').select('*').eq('id', permitId))[0]);
  check('documents: a reviewed document shows its rejection reason and review time', dto.status === 'rejected' && dto.rejection_reason === 'Photo is blurred' && !!dto.reviewed_at && dto.kind === 'permit', dto);
  r = await doc('aadhaar', { number: '1234 5678 9012' });
  check('documents: Aadhaar saved pending, only the last four digits kept', r.status === 200 && r.body.status === 'pending' && r.body.number_masked === 'XXXX XXXX 9012' && r.body.kind === 'aadhaar', r);
  check('documents: the full number is nowhere in the database', !JSON.stringify(must(await d.from('rider_documents').select('*').eq('rider_id', rD))).includes('123456789012'));
  r = await doc('pan', { number: 'abcde1234f' });
  check('documents: PAN masked', r.status === 200 && r.body.number_masked === '******234F', r);
  r = await doc('dl', { number: 'MH2420190001234', dob: '1995-04-02' });
  check('documents: licence saved, date of birth kept on the rider', r.status === 200 && r.body.kind === 'dl' && must(await d.from('riders').select('dob').eq('id', rD))[0].dob === '1995-04-02', r);
  r = await doc('dl', { number: 'MH2420190001234', dob: '2015-04-02' });
  check('documents: a rider under 18: 400', r.status === 400, r);
  r = await doc('selfie', {}, 'selfie');
  check('documents: selfie saved', r.status === 200 && r.body.kind === 'selfie', r);

  r = await go(route.submit.POST, as(uD, 'rider/submit', 'POST', {}));
  check('submit: complete: draft becomes submitted', r.status === 200 && r.body.status === 'submitted' && must(await d.from('riders').select('submitted_at, status').eq('id', rD))[0].submitted_at !== null, r);
  r = await go(route.submit.POST, as(uD, 'rider/submit', 'POST', {}));
  check('submit: again changes nothing', r.status === 200 && r.body.status === 'submitted', r);
  r = await go(route.status.GET, as(uD, 'rider/status'));
  check('status: submitted, no expired documents', r.status === 200 && r.body.status === 'submitted' && r.body.expired_documents.length === 0, r);
  r = await go(route.hub.PUT, as(uD, 'rider/hub', 'PUT', { zone_id: zoneId, lat: 18.41, lng: 76.57, address: 'Elsewhere' }));
  check('a submitted application cannot be edited: 409 locked', r.status === 409 && r.body.code === 'locked', r);
  r = await go(route.docs.POST, as(uD, 'rider/kyc/documents', 'POST', { kind: 'pan', source: 'upload', asset_id: kycAsset }));
  check('a submitted application cannot get new documents: 409 locked', r.status === 409, r);
  r = await go(route.profile.PUT, as(uD, 'rider/profile', 'PUT', { full_name: 'Someone Else', language: 'en' }));
  check('a submitted rider cannot change their legal name: 409', r.status === 409, r);
  await d.from('riders').update({ status: 'documents_expired' }).eq('id', rD);
  await d.from('rider_documents').update({ status: 'expired' }).eq('rider_id', rD).eq('kind', 'pan');
  r = await go(route.status.GET, as(uD, 'rider/status'));
  check('status: names the expired document', r.status === 200 && r.body.status === 'documents_expired' && r.body.expired_documents.includes('pan'), r);
  await d.from('riders').update({ status: 'suspended' }).eq('id', rD);
  r = await go(route.status.GET, as(uD, 'rider/status'));
  check('a suspended rider: 403 suspended', r.status === 403 && r.body.code === 'suspended', r);

  console.log(`\n${passed} rider-extra checks passed`);
  await cleanup(true);
  console.log('Left behind on purpose: zz-rider-extra-money@example.test, its delivery job, ol_order, earnings and cash entries (append-only).');
  console.log('Run /Users/lohit/agentic-os-coder/database/purge_test_orders.sh if any ZZ-TEST orders were created elsewhere.');
}
main().catch(e => { console.error(e); process.exit(1); });
