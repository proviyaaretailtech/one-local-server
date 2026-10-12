// Customer push registry (migration 0234, server/push.ts pushToCustomer, app/api/customer/devices+api.ts) against the LOCAL Supabase.
// Expo's push service is a mocked fetch: nothing leaves the machine. Sign-in is simulated (auth/v1/user answered locally); the database is real.
// Refuses anything but localhost. Removes the devices it creates. Its one opt-out check writes a consent row for a throw-away user id; consent rows
// are append-only evidence (the app cannot delete them), so that single row stays unless removed with database/psql.sh under ol.privacy_purge.
// Run from frontend/:  npx tsx scripts/customer-push-checks.ts   (needs frontend/.env.localdb.off)
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
for (const line of readFileSync(`${process.cwd()}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };

const tokenToUser = new Map<string, string>();
const expoCalls: { to: string; title: string }[][] = [];
let expoTickets: (tos: string[]) => unknown[] = tos => tos.map(() => ({ status: 'ok' }));
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith('/auth/v1/user')) { const t = String(init?.headers?.Authorization ?? '').slice(7); return tokenToUser.has(t) ? Response.json({ id: tokenToUser.get(t) }) : new Response('{}', { status: 401 }); }
  if (url.startsWith('https://exp.host/')) { const msgs = JSON.parse(init.body); expoCalls.push(msgs); return Response.json({ data: expoTickets(msgs.map((m: any) => m.to)) }); }
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error(`blocked non-local request in test: ${url}`);
  return realFetch(input, init);
}) as typeof fetch;

const sfx = randomBytes(4).toString('hex');
const T1 = `ExponentPushToken[ZZ-cust-${sfx}-1]`, T2 = `ExponentPushToken[ZZ-cust-${sfx}-2]`;

async function main() {
  const { db } = await import('../server/db');
  const { pushToCustomer } = await import('../server/push');
  const devices = await import('../app/api/customer/devices+api');
  const d = db();
  const { data: list } = await d.auth.admin.listUsers({ perPage: 50 });
  if (!list || list.users.length < 2) throw new Error('need 2 auth users in the local database');
  const [uA, uB] = [list.users[0].id, list.users[1].id];
  const jwt = (i: number) => { const t = `cp-token-${i}-`.padEnd(40, 'x'); tokenToUser.set(t, [uA, uB][i]); return t; };
  const call = async (handler: any, who: number | null, method: string, body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (who !== null) headers.authorization = `Bearer ${jwt(who)}`;
    const res = await handler(new Request('http://localhost/api/customer/devices', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), {});
    const text = await res.text();
    return { status: res.status as number, body: text ? JSON.parse(text) : null };
  };
  const live = async (user: string) => ((await d.from('ol_customer_devices').select('expo_push_token').eq('user_id', user).is('revoked_at', null)).data ?? []).map((r: any) => r.expo_push_token as string).sort();
  const msg = { title: 'Order accepted', body: 'The restaurant is preparing your order.', data: { type: 'order_accepted' } };
  const ghost = crypto.randomUUID(); // throw-away customer for the opt-out check
  try {
    // ---- registration route
    check('register: not signed in -> 401', (await call(devices.PUT, null, 'PUT', { expo_push_token: T1, platform: 'ios' })).status === 401);
    check('register: bad token -> 422', (await call(devices.PUT, 0, 'PUT', { expo_push_token: 'nope', platform: 'ios' })).status === 422);
    check('register: bad platform -> 422', (await call(devices.PUT, 0, 'PUT', { expo_push_token: T1, platform: 'symbian' })).status === 422);
    check('register: a signed-in customer registers a phone', (await call(devices.PUT, 0, 'PUT', { expo_push_token: T1, platform: 'ios', locale: 'hi-IN' })).status === 200 && (await live(uA)).includes(T1));
    await call(devices.PUT, 0, 'PUT', { expo_push_token: T2, platform: 'android' });
    check('register: a second phone, and registering again does not duplicate', (await call(devices.PUT, 0, 'PUT', { expo_push_token: T2, platform: 'android' })).status === 200 && (await live(uA)).filter(t => t === T2).length === 1);

    // ---- sending
    check('push: no account (guest order) is skipped', (await pushToCustomer(null, msg)).skipped === 'no_account' && expoCalls.length === 0);
    const sent = await pushToCustomer(uA, msg);
    check('push: both phones get the order update', sent.sent === 2 && expoCalls.length === 1 && expoCalls[0].map(m => m.to).sort().join() === [T1, T2].sort().join() && expoCalls[0][0].title === msg.title, { sent, expoCalls });
    check('push: a customer with no phone is skipped (no_devices)', (await pushToCustomer(uB, msg)).skipped === 'no_devices' && expoCalls.length === 1);
    expoTickets = tos => tos.map(t => t === T2 ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' });
    const dead = await pushToCustomer(uA, msg);
    check('push: Expo says a phone is gone -> sent 1 and that token is revoked', dead.sent === 1 && JSON.stringify(await live(uA)) === JSON.stringify([T1]), { dead, live: await live(uA) });
    expoTickets = tos => tos.map(() => ({ status: 'ok' }));

    // ---- A cannot touch B
    await call(devices.PUT, 1, 'PUT', { expo_push_token: `ExponentPushToken[ZZ-cust-${sfx}-b]`, platform: 'ios' });
    check('revoke: one customer cannot revoke another customer\'s phone', (await call(devices.DELETE, 0, 'DELETE', { expo_push_token: `ExponentPushToken[ZZ-cust-${sfx}-b]` })).body?.revoked === 0 && (await live(uB)).length === 1);
    check('revoke: needs a token or all:true', (await call(devices.DELETE, 0, 'DELETE', {})).status === 422);
    check('revoke: sign-out revokes this phone', (await call(devices.DELETE, 0, 'DELETE', { expo_push_token: T1 })).body?.revoked === 1 && (await live(uA)).length === 0);
    const calls = expoCalls.length;
    check('push: a signed-out phone gets nothing', (await pushToCustomer(uA, msg)).skipped === 'no_devices' && expoCalls.length === calls);

    // ---- consent: a withdrawn push choice stops every push
    must(await d.rpc('ol_customer_device_register', { p_user: ghost, p_token: `ExponentPushToken[ZZ-cust-${sfx}-g]`, p_platform: 'ios', p_locale: null }));
    check('consent: a customer who never chose is sent to (order updates are transactional)', (await pushToCustomer(ghost, msg)).sent === 1);
    must(await d.from('ol_consents').insert({ user_id: ghost, channel: 'push', purpose: 'marketing', granted: false, notice_version: 'zz-test', source: 'privacy_screen' }));
    const before = expoCalls.length;
    check('consent: push withdrawn -> opted_out and nothing is sent', (await pushToCustomer(ghost, msg)).skipped === 'opted_out' && expoCalls.length === before);
  } finally {
    await d.from('ol_customer_devices').delete().like('expo_push_token', `ExponentPushToken[ZZ-cust-${sfx}%`);
    await d.from('ol_customer_devices').delete().in('user_id', [uA, uB, ghost]).like('expo_push_token', '%ZZ-cust-%');
  }
  console.log(`${passed} checks passed`);
}
function must(r: { data: any; error: any }) { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; }
main().catch(e => { console.error(e); process.exit(1); });
