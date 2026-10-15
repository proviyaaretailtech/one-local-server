// Runs the dispatch flow end to end through the real server code against the LOCAL Supabase: an order is
// placed, the nearest rider is offered it, declines move it on, accept wins, cancel, the sweep, auto-accept.
// Expo push and sign-in are simulated; the database is real. It refuses to run against anything but localhost,
// and removes what it creates.
// Needs the local database with 0021-0026 and 0029 applied, and frontend/.env.localdb.off (written by
// `python3 scripts/db.py local-env`, then renamed). Run from frontend/:  npx tsx scripts/dispatch-integration.ts
import { readFileSync } from 'node:fs';
const ROOT = process.cwd();
for (const line of readFileSync(`${ROOT}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');
Object.assign(process.env, { DISPATCH_SERVICE_TOKEN: 'it-token', DISPATCH_SIGNING_SECRET: 'it-secret' });

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };

// Expo push and sign-in are simulated; PostgREST is the real local database.
const pushes: any[] = []; const tokenToUser = new Map<string, string>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://exp.host/')) { const msgs = JSON.parse(init.body); pushes.push(...msgs); return Response.json({ data: msgs.map(() => ({ status: 'ok' })) }); }
  if (url.endsWith('/auth/v1/user')) { const t = String(init?.headers?.Authorization ?? '').slice(7); return tokenToUser.has(t) ? Response.json({ id: tokenToUser.get(t) }) : new Response('{}', { status: 401 }); }
  return realFetch(input, init);
}) as typeof fetch;

async function main() {
  const { db } = await import(`../server/db`);
  const { hmacHex, sha256 } = await import(`../server/http`);
  const dispatch = await import(`../server/dispatch`);
  const jobsRoute = await import(`../app/api/dispatch/jobs/index+api`);
  const jobRoute = await import(`../app/api/dispatch/jobs/[id]+api`);
  const cancelRoute = await import(`../app/api/dispatch/jobs/[id]/cancel+api`);
  const sweepRoute = await import(`../app/api/dispatch/sweep+api`);
  const offerRoute = await import(`../app/api/rider/offers/current+api`);
  const acceptRoute = await import(`../app/api/rider/offers/[id]/accept+api`);
  const declineRoute = await import(`../app/api/rider/offers/[id]/decline+api`);
  const availRoute = await import(`../app/api/rider/availability+api`);
  const beatRoute = await import(`../app/api/rider/heartbeat+api`);
  const tokenRoute = await import(`../app/api/rider/push-token+api`);
  const myJobRoute = await import(`../app/api/rider/jobs/[id]+api`);
  const stepRoute = await import(`../app/api/rider/jobs/[id]/step+api`);
  const verifyRoute = await import(`../app/api/rider/jobs/[id]/pickup-verify+api`);
  const proofRoute = await import(`../app/api/rider/jobs/[id]/proof+api`);
  const problemRoute = await import(`../app/api/rider/jobs/[id]/exception+api`);
  const reassignRoute = await import(`../app/api/dispatch/jobs/[id]/reassign+api`);
  const resolveRoute = await import(`../app/api/dispatch/exceptions/[id]/resolve+api`);
  const eventsRoute = await import(`../app/api/dispatch/events+api`);
  const currentJobRoute = await import(`../app/api/rider/jobs/current+api`);
  const d = db();
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };

  // ---- seed (cleaned up at the end) ----
  const org = must(await d.from('organizations').select('id').limit(1))[0].id as string;
  // Logins that are not yet a rider or a platform admin (another script's, or the demo seed's, riders must not collide with these).
  const { data: list } = await d.auth.admin.listUsers({ perPage: 100 });
  const taken = new Set([...((await d.from('riders').select('user_id')).data ?? []), ...((await d.from('platform_admins').select('user_id')).data ?? [])].map((r: any) => r.user_id));
  const u = list!.users.map(x => x.id).filter(id => !taken.has(id)).slice(0, 6);
  if (u.length < 4) throw new Error('need 4 unused auth users in the local database');
  must(await d.from('ol_stores').upsert({ id: 'it-store', name: 'IT Kitchen', organization_id: org }));
  must(await d.from('ol_merchant_channels').upsert({ organization_id: org, store_id: 'it-store', accepting: true, address: 'Main Road, Latur', lat: 18.4088, lng: 76.5604 }));
  const mk = async (i: number, name: string, extra: any = {}) => must(await d.from('riders').insert({ user_id: u[i], full_name: name, type: 'solo', status: 'approved', vehicle: 'bike', ...extra }).select('id'))[0].id as string;
  const rNear = await mk(0, 'Ravi Kumar'), rFar = await mk(1, 'Sana Sheikh'), rAuto = await mk(2, 'Auto Amit', { acceptance: 'auto' });
  const now = () => new Date().toISOString();
  must(await d.from('rider_availability').upsert([
    { rider_id: rNear, online: true, lat: 18.4100, lng: 76.5604, last_seen_at: now() },
    { rider_id: rFar, online: true, lat: 18.4300, lng: 76.5604, last_seen_at: now() },
    { rider_id: rAuto, online: false, lat: 18.41, lng: 76.56, last_seen_at: now() },
  ]));
  const jwt = (i: number) => { const t = `token-${i}-`.padEnd(40, 'x'); tokenToUser.set(t, u[i]); return t; };
  const as = (i: number, url: string, method = 'GET', body?: unknown) => new Request(`http://localhost/api/${url}`, { method, headers: { authorization: `Bearer ${jwt(i)}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const svc = async (url: string, body?: unknown, key?: string) => {
    // X-Signature = HMAC(secret, METHOD \n path?query \n timestamp \n sha256(raw body)): the request it was made for, and no other.
    const raw = body === undefined ? '' : JSON.stringify(body); const stamp = String(Math.floor(Date.now() / 1000));
    const method = body === undefined ? 'GET' : 'POST', at = new URL(`http://localhost/api/${url}`);
    return new Request(`http://localhost/api/${url}`, { method, headers: { authorization: 'Bearer it-token', 'x-request-id': 'it-1', 'x-timestamp': stamp, 'x-signature': await hmacHex('it-secret', `${method}\n${at.pathname}${at.search}\n${stamp}\n${await sha256(raw)}`), ...(body !== undefined ? { 'idempotency-key': key ?? 'it-key-0001-aaaa' } : {}) }, body: raw || undefined });
  };
  const order = async (extra: any = {}) => must(await d.from('ol_orders').insert({
    customer_hash: 'it', items: [{ id: 'x', name: 'Biryani', qty: 2, price: 200 }], subtotal: 400, total: 460, store_id: 'it-store', organization_id: org, eta_minutes: 30,
    delivery_address: { label: 'Home', text: 'Flat 4, Gandhi Chowk, Latur', lat: 18.4001, lng: 76.5702, notes: 'Ring twice' }, ...extra }).select('id'))[0].id as string;

  // The restaurant's accept releases the job (server default trigger is 'accepted'); the test stands in for it.
  const place = async (ids: string[]) => {
    await dispatch.dispatchOrders(ids);
    for (const id of ids) { const j = (await d.from('delivery_jobs').select('id').eq('ol_order_id', id).maybeSingle()).data; if (j) await dispatch.releaseJob(j.id as string, 20, null, `it-accept:${id}`); }
  };
  // Direct status writes are refused (0229): fixtures move a job through the real dispatch_step / dispatch_verify_pickup doors.
  let stepN = 0;
  const walk = async (jobId: string, riderId: string, tos: string[]) => {
    for (const to of tos) {
      const v = must(await d.from('delivery_jobs').select('version').eq('id', jobId).single()).version;
      const key = `it-walk-${jobId.slice(0, 8)}-${++stepN}`;
      const { error } = to === 'verified'
        ? await d.rpc('dispatch_verify_pickup', { p_job: jobId, p_rider: riderId, p_expected: v, p_key: key, p_hash: key, p_items_ok: true, p_recorded_at: null, p_request_id: key })
        : await d.rpc('dispatch_step', { p_job: jobId, p_rider: riderId, p_to: to, p_expected: v, p_key: key, p_hash: key, p_lat: 18.4088, p_lng: 76.5604, p_accuracy: 10, p_recorded_at: null, p_reason: null, p_request_id: key });
      if (error) throw new Error(`walk ${to}: ${JSON.stringify(error)}`);
    }
  };

  await d.from('idempotency_keys').delete().eq('scope', 'dispatch:service').like('key', '%-it-%'); // keys of an earlier run (the route-level idempotency, server/idempotency.ts)
  // rider-side registration
  let res = await tokenRoute.PUT(as(0, 'rider/push-token', 'PUT', { expo_push_token: 'ExponentPushToken[near-near-near-1]', platform: 'android' }), {});
  check('rider registers a push token', res.status === 200, await res.json());
  await tokenRoute.PUT(as(2, 'rider/push-token', 'PUT', { expo_push_token: 'ExponentPushToken[auto-auto-auto-1]', platform: 'ios' }), {});
  res = await availRoute.POST(as(0, 'rider/availability', 'POST', { online: true, lat: 18.41, lng: 76.5604 }), {});
  check('rider goes online inside the delivery area', res.status === 200, await res.json());
  res = await availRoute.POST(as(0, 'rider/availability', 'POST', { online: true, lat: 18.5204, lng: 73.8567 }), {});
  check('going online far away is refused: out_of_zone', res.status === 422 && (await res.json()).code === 'out_of_zone');
  res = await beatRoute.POST(as(0, 'rider/heartbeat', 'POST', { lat: 18.4100, lng: 76.5604, battery: 80 }), {});
  check('heartbeat is accepted while online', res.status === 200 && (await res.json()).online === true);
  res = await offerRoute.GET(as(3, 'rider/offers/current'), {});
  check('a login with no rider row is refused: not_enrolled', res.status === 403 && (await res.json()).code === 'not_enrolled');

  // ---- 1. a successful cash order pings the pool ----
  const o1 = await order();
  await place([o1]);
  let job = must(await d.from('delivery_jobs').select('*').eq('ol_order_id', o1).single());
  check('the order flow created one job (released by the restaurant accept)', job.status === 'offered' && job.dispatch_trigger === 'accepted' && job.cash_to_collect == 460 && job.items_count === 2, job);
  check('pickup came from the restaurant channel (no store coordinates needed)', job.pickup_lat === 18.4088 && job.pickup_address === 'Main Road, Latur' && job.pickup_name === 'IT Kitchen', job);
  check('the drop area, notes and coordinates were taken from the order', job.drop_area === 'Gandhi Chowk' && job.drop_notes === 'Ring twice' && job.drop_lat === 18.4001, job);
  const asg = must(await d.from('delivery_assignments').select('*').eq('job_id', job.id));
  check('the nearest rider was offered it, and only one live offer exists', asg.length === 1 && asg[0].rider_id === rNear && asg[0].outcome === null, asg);
  check('their phone was rung with the job offer', pushes.some(p => p.to === 'ExponentPushToken[near-near-near-1]' && p.data.type === 'job_offer' && p.data.offer_id === asg[0].id && p.channelId === 'job-offers'), pushes);
  await dispatch.dispatchOrders([o1]);
  check('sending the same order again changes nothing (one job per order)', must(await d.from('delivery_jobs').select('id').eq('ol_order_id', o1)).length === 1 && must(await d.from('delivery_assignments').select('id').eq('job_id', job.id)).length === 1);
  check("the customer's code is derived, not stored", job.otp_hash === await dispatch.otpHash(o1, await dispatch.deliveryOtp(o1)) && !JSON.stringify(job).includes(await dispatch.deliveryOtp(o1) + '"'));

  res = await offerRoute.GET(as(0, 'rider/offers/current'), {});
  const offer = await res.json();
  check("the rider's app sees the live offer with seconds left, no street address", res.status === 200 && offer.offer_id === asg[0].id && offer.seconds_left > 20 && offer.job.drop.address === null && offer.job.drop.customer_phone === null, offer);
  check('the rider far away has no offer', (await offerRoute.GET(as(1, 'rider/offers/current'), {})).status === 204);

  // ---- 2. decline moves on; accept wins; double accept is safe ----
  res = await declineRoute.POST(as(0, 'x', 'POST', { reason: 'too far' }), { id: offer.offer_id });
  check('declining is accepted', res.status === 200);
  const second = must(await d.from('delivery_assignments').select('*').eq('job_id', job.id).order('round'));
  check('the next rider is offered straight away (round 2)', second.length === 2 && second[1].rider_id === rFar && second[1].outcome === null, second);
  await tokenRoute.PUT(as(1, 'rider/push-token', 'PUT', { expo_push_token: 'ExponentPushToken[far-far-far-1]', platform: 'android' }), {});
  res = await acceptRoute.POST(as(0, 'x', 'POST'), { id: second[1].id });
  check("a rider cannot answer someone else's offer", res.status === 404, await res.json());
  res = await acceptRoute.POST(as(1, 'x', 'POST'), { id: second[1].id });
  const accepted = await res.json();
  check('accepting assigns the job and returns it in the rider view', res.status === 200 && accepted.status === 'assigned' && accepted.state === 'accepted' && accepted.pickup.address === 'Main Road, Latur' && accepted.drop.address === null && accepted.drop.customer_phone === null && accepted.cash_to_collect === 460, accepted);
  res = await acceptRoute.POST(as(1, 'x', 'POST'), { id: second[1].id });
  check('accepting twice is the same accept', res.status === 200);
  res = await acceptRoute.POST(as(0, 'x', 'POST'), { id: asg[0].id });
  check('answering an offer that already ended: offer_expired', res.status === 409 && (await res.json()).code === 'offer_expired');
  res = await myJobRoute.GET(as(1, 'x'), { id: job.id });
  check('the assigned rider can read their job', res.status === 200);
  res = await myJobRoute.GET(as(0, 'x'), { id: job.id });
  check("another rider cannot read someone else's job", res.status === 404);
  res = await currentJobRoute.GET(as(1, 'x'), {});
  check('GET jobs/current returns the active job', res.status === 200 && (await res.json()).id === job.id);

  // ---- 3. the order side reads it back (service credential) ----
  res = await jobRoute.GET(await svc(`dispatch/jobs/${job.id}`), { id: job.id });
  const view = await res.json();
  check('tracking read: assigned, rider first name only, ETA, timeline', res.status === 200 && view.status === 'assigned' && view.rider.first_name === 'Sana' && !JSON.stringify(view).includes('Shaikh') && view.eta_minutes >= 1 && view.timeline.map((t: any) => t.kind).join() === 'delivery.created,delivery.released,delivery.offered,delivery.rejected,delivery.offered,delivery.assigned', view);
  res = await jobsRoute.GET(await svc(`dispatch/jobs?ol_order_id=${o1}`), {});
  check('the same read works by order id', res.status === 200 && (await res.json()).job_id === job.id);

  // ---- 4. HTTP create: 201 then 200, and an order that is not deliverable ----
  const o2 = await order();
  const body = (id: string) => ({ ol_order_id: id, organization_id: org, store_id: 'it-store', order_no: 'A-1', payment_mode: 'cod', cash_to_collect: 460, items: { count: 2, temperature: 'hot' }, prep_minutes: 20,
    pickup: { name: 'IT Kitchen', address: 'Main Road', lat: 18.4088, lng: 76.5604 }, drop: { area: 'Gandhi Chowk', lat: 18.4001, lng: 76.5702, customer_first_name: 'Asha' } });
  await d.from('rider_availability').update({ online: false }).in('rider_id', [rNear, rFar]);
  res = await jobsRoute.POST(await svc('dispatch/jobs', body(o2), `onelocal:${o2}:delivery`), {});
  const created = await res.json();
  check('POST /dispatch/jobs creates the job: 201, waiting for the restaurant', res.status === 201 && created.status === 'created' && created.offer.state === 'waiting_for_restaurant', created);
  res = await jobsRoute.POST(await svc('dispatch/jobs', body(o2), `onelocal:${o2}:delivery`), {});
  check('the same call again returns the first job: 200', res.status === 200 && (await res.json()).job_id === created.job_id);
  await dispatch.releaseJob(created.job_id, 20, null, 'it-accept-o2'); // the restaurant accepts; nobody is online so the job waits for a rider
  const o3 = await order({ status: 'cancelled' });
  res = await jobsRoute.POST(await svc('dispatch/jobs', body(o3), `onelocal:${o3}:delivery`), {});
  check('a cancelled order is not deliverable: 409 order_not_deliverable', res.status === 409 && (await res.json()).code === 'order_not_deliverable');
  res = await jobsRoute.POST(await svc('dispatch/jobs', body('3b0f5b9e-8f55-4a52-9d57-2d6f4c0c1a99'), 'onelocal:missing:delivery'), {});
  check('an unknown order: 404', res.status === 404, await res.json());

  // ---- 5. nobody online: the job waits; a rider coming online picks it up; auto-accept assigns instantly ----
  await d.from('rider_availability').update({ online: true, last_seen_at: now(), lat: 18.41, lng: 76.56 }).eq('rider_id', rAuto);
  pushes.length = 0;
  res = await beatRoute.POST(as(0, 'rider/heartbeat', 'POST', { lat: 18.41, lng: 76.56 }), {});
  await d.from('rider_availability').update({ online: true, last_seen_at: now(), lat: 18.41, lng: 76.56 }).eq('rider_id', rAuto);
  const s1 = await (await sweepRoute.POST(await svc('dispatch/sweep', {}, 'sweep-it-0001'), {})).json();
  const j2 = must(await d.from('delivery_jobs').select('*').eq('id', created.job_id).single());
  check('the sweep offered the waiting job; the auto-accept rider was assigned instantly', j2.status === 'assigned' && j2.rider_id === rAuto && s1.advanced >= 1, { j2, s1 });
  check('the auto rider was told it was assigned', pushes.some(p => p.to === 'ExponentPushToken[auto-auto-auto-1]' && p.data.type === 'job_assigned'), pushes);

  // ---- 6. cancel ----
  res = await cancelRoute.POST(await svc('x', { reason: 'customer_cancelled' }, 'cancel-it-0001'), { id: created.job_id });
  const cancelled = await res.json();
  check('cancel before pickup: cancelled, and the assigned rider is told', res.status === 200 && cancelled.status === 'cancelled' && pushes.some(p => p.data.type === 'job_cancelled'), cancelled);
  await walk(job.id, rFar, ['to_pickup', 'at_pickup', 'verified', 'picked_up']);
  res = await cancelRoute.POST(await svc('x', { reason: 'customer_cancelled' }, 'cancel-it-0002'), { id: job.id });
  check('cancel after pickup: 409 already_picked_up', res.status === 409 && (await res.json()).code === 'already_picked_up');

  // ---- 7. the sweep retries an order that never got a job, and cancels jobs of cancelled orders ----
  const o4 = await order({ created_at: new Date(Date.now() - 5 * 60_000).toISOString() });
  const o5 = await order();
  await place([o5]);
  must(await d.rpc('order_transition', { p_order: o5, p_event: 'ops_cancel', p_actor: 'system', p_idempotency_key: null, p_meta: { cancel_reason: 'it' } })); // the DB cascade cancels the job too; the sweep must still tolerate it
  const s2 = await (await sweepRoute.POST(await svc('dispatch/sweep', {}, 'sweep-it-0002'), {})).json();
  // The sweep first tries to hand a stuck unadopted order to its restaurant; this fixture has no menu mapping, so it is cancelled through
  // order_transition (cancelUnfulfillable) and gets no job. If adoption is possible it gets one instead. Either way it is dealt with.
  const o4row = must(await d.from('ol_orders').select('status').eq('id', o4).single());
  const o4jobs = must(await d.from('delivery_jobs').select('id').eq('ol_order_id', o4)).length;
  check('the sweep dealt with the stuck order (a job, or an order_transition cancel when no restaurant can take it)', (o4jobs === 1 && s2.created >= 1) || (o4jobs === 0 && o4row.status === 'cancelled'), { s2, o4row, o4jobs });
  check("the sweep cancelled the job of a cancelled order", must(await d.from('delivery_jobs').select('status').eq('ol_order_id', o5))[0].status === 'cancelled', s2);

  // ---- 8. an online order is only dispatched once paid ----
  const o6 = await order({ payment_method: 'upi', payment_status: 'pending' });
  await dispatch.dispatchOrders([o6]);
  check('an unpaid online order gets no job', must(await d.from('delivery_jobs').select('id').eq('ol_order_id', o6)).length === 0);
  await d.from('ol_orders').update({ payment_status: 'paid' }).eq('id', o6);
  await place([o6]);
  const j6 = must(await d.from('delivery_jobs').select('*').eq('ol_order_id', o6).single());
  check('once paid it does, with no cash to collect', j6.payment_mode === 'online' && Number(j6.cash_to_collect) === 0, j6);

  // ---- 9. after assignment: steps, retries, wrong codes, a problem, proof, reassignment ----
  await d.from('delivery_assignments').update({ outcome: 'withdrawn' }).is('outcome', null);
  for (const j of must(await d.from('delivery_jobs').select('id').eq('store_id', 'it-store').in('status', ['created', 'offered', 'assigned', 'at_pickup']))) await d.rpc('dispatch_cancel', { p_job: j.id, p_reason: 'it cleanup', p_expected: null, p_request_id: `it-clean-${j.id}` });
  await d.from('rider_availability').update({ online: false }).in('rider_id', [rNear, rFar]);
  await d.from('rider_availability').update({ online: true, last_seen_at: now(), lat: 18.41, lng: 76.56 }).eq('rider_id', rAuto);
  const o7 = await order();
  await place([o7]);
  const j7 = must(await d.from('delivery_jobs').select('*').eq('ol_order_id', o7).single());
  check('a fresh job was assigned to the auto-accept rider', j7.status === 'assigned' && j7.rider_id === rAuto, j7);
  const cmd = (url: string, body: any, key: string, who = 2) => new Request(`http://localhost/api/${url}`, { method: 'POST', headers: { authorization: `Bearer ${jwt(who)}`, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });
  const step = async (to: string, v: number, key: string, extra: any = {}) => { const r = await stepRoute.POST(cmd('x', { to, version: v, ...extra }, key), { id: j7.id }); return { res: r, body: await r.json() }; };
  let v = j7.version;
  let r = await stepRoute.POST(new Request('http://localhost/api/x', { method: 'POST', headers: { authorization: `Bearer ${jwt(2)}`, 'content-type': 'application/json' }, body: JSON.stringify({ to: 'to_pickup', version: v }) }), { id: j7.id });
  check('a command without an Idempotency-Key is refused', r.status === 400 && (await r.json()).code === 'validation');
  let s = await step('to_pickup', v, 'it-step-0001');
  check('step to_pickup: the rider view moves, version goes up', s.res.status === 200 && s.body.display_state === 'to_pickup' && s.body.version === v + 1 && s.body.drop.address === null, s.body);
  const again = await step('to_pickup', v, 'it-step-0001');
  check('the same command sent again replays: same answer, header set, no second change', again.res.status === 200 && again.res.headers.get('Idempotent-Replay') === 'true' && again.body.version === v + 1 && must(await d.from('delivery_events').select('id').eq('job_id', j7.id).eq('kind', 'delivery.to_pickup')).length === 1, again.body);
  const changed = await step('to_pickup', v, 'it-step-0001', { lat: 1 });
  check('the same key with another body: 422 idempotency_mismatch', changed.res.status === 422 && changed.body.code === 'idempotency_mismatch', changed.body);
  const stale = await step('at_pickup', v, 'it-step-0002', { lat: 18.4088, lng: 76.5604, accuracy_m: 8 });
  check('a stale version: 409 version_conflict with the server job', stale.res.status === 409 && stale.body.code === 'version_conflict' && stale.body.server_version === v + 1 && stale.body.job.id === j7.id, stale.body);
  v += 1;
  const far = await step('at_pickup', v, 'it-step-0003', { lat: 18.45, lng: 76.5604, accuracy_m: 8 });
  check('arriving far from the pickup: 422 too_far', far.res.status === 422 && far.body.code === 'too_far', far.body);
  s = await step('at_pickup', v, 'it-step-0004', { lat: 18.4088, lng: 76.5604, accuracy_m: 8, recorded_at: new Date(Date.now() - 60_000).toISOString() }); v = s.body.version;
  check('arrived at pickup', s.body.display_state === 'at_pickup' && s.body.pickup.address === 'Main Road, Latur', s.body);
  s = await step('picked_up', v, 'it-step-0005');
  check('picking up before checking the order: 409 (version_conflict, reason invalid_transition)', s.res.status === 409 && s.body.code === 'version_conflict' && s.body.reason === 'invalid_transition', s.body); // the rider API folds a step the job can no longer take into version_conflict (server/rider.ts), original kept in reason
  r = await verifyRoute.POST(cmd('x', { version: v, items_ok: false }, 'it-verify-0001'), { id: j7.id });
  check('a wrong order cannot be confirmed: 422 pickup_mismatch', r.status === 422 && (await r.json()).code === 'pickup_mismatch');
  r = await verifyRoute.POST(cmd('x', { version: v, items_ok: true }, 'it-verify-0002'), { id: j7.id });
  let b = await r.json(); v = b.version;
  check('pickup checked', r.status === 200 && b.display_state === 'pickup_verified', b);
  r = await stepRoute.POST(cmd('x', { to: 'picked_up', version: v }, 'it-step-0006', 0), { id: j7.id });
  check("another rider cannot move this rider's job: 404", r.status === 404);
  for (const [to, k] of [['picked_up', 6], ['to_drop', 7], ['at_drop', 8], ['handover', 9]] as const) { s = await step(to, v, `it-step-000${k}x`); v = s.body.version; }
  check('after pickup the drop address and the code-free view are shown', s.body.display_state === 'handover' && s.body.drop.address === 'Flat 4, Gandhi Chowk, Latur' && s.body.cash_to_collect === 460 && !JSON.stringify(s.body).includes(await dispatch.deliveryOtp(o7)), s.body); // the code itself never appears (the view now has otp_attempts / proof_methods fields)
  const code = await dispatch.deliveryOtp(o7);
  const wrong = code === '0000' ? '1111' : '0000';
  const proof = (body: any, key: string) => proofRoute.POST(cmd('x', { version: v, lat: 18.4001, lng: 76.5702, cash_collected: 460, ...body }, key), { id: j7.id });
  for (let i = 1; i <= 4; i++) { r = await proof({ method: 'otp', code: wrong }, `it-proof-bad${i}`); b = await r.json(); check(`wrong code ${i}: 422 otp_invalid, ${5 - i} left`, r.status === 422 && b.code === 'otp_invalid' && b.attempts_left === 5 - i, b); }
  r = await proof({ method: 'otp', code: wrong }, 'it-proof-bad5'); b = await r.json();
  check('the fifth wrong code: 423 otp_locked, the job is held for operations', r.status === 423 && b.code === 'otp_locked' && b.job.display_state === 'exception', b);
  const exr = must(await d.from('delivery_exceptions').select('*').eq('job_id', j7.id).eq('status', 'open'))[0];
  check('a proof_failed problem is open', exr?.kind === 'proof_failed', exr);
  r = await resolveRoute.POST(await svc('x', { outcome: 'resume', note: 'customer confirmed' }, 'resolve-it-0001'), { id: exr.id });
  b = await r.json(); v = b.job.version;
  check('operations resumed it: back to handover', r.status === 200 && b.job.status === 'at_drop', b);
  r = await proof({ method: 'otp', code, cash_collected: 100 }, 'it-proof-cash'); b = await r.json();
  check('the wrong cash amount: 422 validation (reason cash_mismatch)', r.status === 422 && b.code === 'validation' && b.reason === 'cash_mismatch', b); // folded into the app's vocabulary (server/rider.ts alignCode)
  r = await proof({ method: 'otp', code }, 'it-proof-ok'); b = await r.json();
  check('the right code and cash: delivered', r.status === 200 && b.status === 'delivered' && b.display_state === 'delivered' && b.cash_collected === 460 && b.flagged === false, b);
  check('the delivery is closed in the database with a proof', must(await d.from('delivery_jobs').select('status, delivered_at').eq('id', j7.id))[0].status === 'delivered' && must(await d.from('delivery_proofs').select('method').eq('job_id', j7.id))[0].method === 'otp');
  r = await myJobRoute.GET(as(2, 'rider/jobs/' + j7.id), { id: j7.id });
  check('a delivered job is no longer the current job', (await currentJobRoute.GET(as(2, 'rider/jobs/current'), {})).status === 204 && r.status === 200);

  // a problem before pickup, reassigned to another rider
  const o8 = await order();
  await place([o8]);
  const j8 = must(await d.from('delivery_jobs').select('*').eq('ol_order_id', o8).single());
  check('the next job went to the auto rider again', j8.rider_id === rAuto && j8.status === 'assigned', j8);
  r = await problemRoute.POST(cmd('x', { kind: 'vehicle', note: 'tyre burst', version: j8.version, lat: 18.41, lng: 76.56 }, 'it-problem-01'), { id: j8.id });
  b = await r.json();
  check('a reported problem holds the job and tells the rider what to do', r.status === 200 && b.display_state === 'exception' && b.next_actions.includes('request_reassignment') && b.exception.kind === 'vehicle', b);
  await d.from('rider_availability').update({ online: true, last_seen_at: now(), lat: 18.4100, lng: 76.5604 }).eq('rider_id', rNear);
  r = await reassignRoute.POST(await svc('x', { reason: 'rider vehicle broke down' }, 'reassign-it-0001'), { id: j8.id });
  b = await r.json();
  check('operations reassigned it: the other rider is offered it, the first is out', r.status === 200 && b.status === 'offered' && must(await d.from('delivery_jobs').select('rider_id').eq('id', j8.id))[0].rider_id === null && must(await d.from('delivery_assignments').select('rider_id').eq('job_id', j8.id).is('outcome', null))[0].rider_id === rNear, b);
  res = await eventsRoute.GET(await svc('dispatch/events?after=0&limit=500'), {});
  const feed = await res.json();
  check('the event feed carries the new events by cursor', res.status === 200 && ['delivery.to_pickup', 'delivery.pickup_verified', 'delivery.proof_submitted', 'delivery.delivered', 'delivery.exception', 'delivery.reassigned'].every(k => feed.events.some((e: any) => e.kind === k)) && feed.next >= feed.events[feed.events.length - 1].id, feed.events.map((e: any) => e.kind));


  console.log(`\n${passed} integration checks passed`);
  // ---- cleanup ----
  const ids = must(await d.from('ol_orders').select('id').eq('customer_hash', 'it')).map((x: any) => x.id);
  await d.from('delivery_jobs').delete().in('ol_order_id', ids);
  await d.rpc('ol_dev_purge_orders', { p_ids: ids, p_reason: 'dispatch-integration cleanup' });
  await d.from('riders').delete().in('id', [rNear, rFar, rAuto]);
  await d.from('ol_merchant_channels').delete().eq('organization_id', org);
  await d.from('ol_stores').delete().eq('id', 'it-store');
}
main().catch(e => { console.error(e); process.exit(1); });
