// Checks W0-2 (DELETE /api/rider/push-token) and W0-6 (platform admin lookup on the live platform_admins columns)
// with the real route handlers against the LOCAL Supabase. Sign-in is simulated; the database is real. Refuses non-local.
// Cleans up after itself (riders, push_tokens and the platform_admins row it creates). Run from frontend/:
//   npx tsx scripts/push-token-admin-checks.ts
import { readFileSync } from 'node:fs';

for (const line of readFileSync(`${process.cwd()}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };

const tokenToUser = new Map<string, string>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith('/auth/v1/user')) { const t = String(init?.headers?.Authorization ?? '').slice(7); return tokenToUser.has(t) ? Response.json({ id: tokenToUser.get(t) }) : new Response('{}', { status: 401 }); }
  return realFetch(input, init);
}) as typeof fetch;

const T1 = 'ExponentPushToken[ZZ-test-phone-one]', T2 = 'ExponentPushToken[ZZ-test-phone-two]', TB = 'ExponentPushToken[ZZ-test-other-rider]';

async function main() {
  const { db } = await import('../server/db');
  const push = await import('../app/api/rider/push-token+api');
  const meRoute = await import('../app/api/admin/me+api');
  const d = db();
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
  const { data: list } = await d.auth.admin.listUsers({ perPage: 50 });
  const taken = new Set([...((await d.from('riders').select('user_id')).data ?? []), ...((await d.from('platform_admins').select('user_id')).data ?? [])].map((r: any) => r.user_id));
  const u = list!.users.filter(x => !taken.has(x.id));
  if (u.length < 3) throw new Error('need 3 unused auth users in the local database');
  const jwt = (i: number) => { const t = `pt-token-${i}-`.padEnd(40, 'x'); tokenToUser.set(t, u[i].id); return t; };
  const call = async (handler: any, who: number | null, method: string, body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (who !== null) headers.authorization = `Bearer ${jwt(who)}`;
    const res = await handler(new Request('http://localhost/api/x', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), {});
    const text = await res.text();
    return { status: res.status as number, body: text ? JSON.parse(text) : null };
  };
  let riderIds: string[] = [];
  try {
    const mk = async (i: number, name: string) => must(await d.from('riders').insert({ user_id: u[i].id, full_name: name, type: 'solo', status: 'approved', vehicle: 'bike' }).select('id'))[0].id as string;
    const rA = await mk(0, 'PT Asha'), rB = await mk(1, 'PT Bala');
    riderIds = [rA, rB];
    const tokens = async (rider: string) => ((await d.from('push_tokens').select('expo_push_token').eq('rider_id', rider)).data ?? []).map((t: any) => t.expo_push_token as string).sort();

    // ---- W0-2 ----
    for (const [who, tok] of [[0, T1], [0, T2], [1, TB]] as const) {
      const r = await call(push.PUT, who, 'PUT', { expo_push_token: tok, platform: 'android' });
      check(`PUT registers ${tok}`, r.status === 200 && r.body.ok === true, r);
    }
    check('rider A has two phones, B one', (await tokens(rA)).length === 2 && (await tokens(rB)).length === 1);
    let r = await call(push.DELETE, null, 'DELETE', { expo_push_token: T1 });
    check('DELETE without sign-in is 401', r.status === 401, r);
    r = await call(push.DELETE, 0, 'DELETE', { expo_push_token: 'garbage' });
    check('DELETE with a malformed token is 400 validation', r.status === 400 && r.body.code === 'validation', r);
    r = await call(push.DELETE, 0, 'DELETE', {});
    check('DELETE with neither a token nor all is 400', r.status === 400, r);
    r = await call(push.DELETE, 0, 'DELETE', { all: 'yes', expo_push_token: 'x' });
    check('all must be literally true (a truthy string is not "all devices")', r.status === 400, r);
    r = await call(push.DELETE, 0, 'DELETE', { expo_push_token: TB });
    check("rider A cannot revoke rider B's token (ok, but B's row stays)", r.status === 200 && (await tokens(rB)).join() === TB, { r, b: await tokens(rB) });
    r = await call(push.DELETE, 0, 'DELETE', { expo_push_token: T1 });
    check("DELETE revokes this phone only; the rider's other phone stays", r.status === 200 && (await tokens(rA)).join() === T2, await tokens(rA));
    r = await call(push.DELETE, 0, 'DELETE', { expo_push_token: T1 });
    check('DELETE again is idempotent (200)', r.status === 200 && r.body.ok === true, r);
    r = await call(push.DELETE, 0, 'DELETE', { all: true });
    check('DELETE all drops every phone of the rider and none of anyone else', r.status === 200 && (await tokens(rA)).length === 0 && (await tokens(rB)).join() === TB, { a: await tokens(rA), b: await tokens(rB) });

    // ---- W0-6: platform_admins on live columns ----
    const role = must(await d.from('platform_roles').select('id, key').eq('key', 'super_admin').single());
    const adminUser = 2;
    must(await d.from('platform_admins').insert({ user_id: u[adminUser].id, role_id: role.id, first_name: 'PT', last_name: 'Admin', status: 'Active' }));
    r = await call(meRoute.GET, adminUser, 'GET');
    check('an Active admin is recognised with role from platform_roles, name from first/last, email from auth.users',
      r.status === 200 && r.body.role === 'super_admin' && r.body.full_name === 'PT Admin' && r.body.email === u[adminUser].email && r.body.can_write === true, r);
    const g = globalThis as any; g.__onecityAdmins?.clear();
    must(await d.from('platform_admins').update({ status: 'Suspended' }).eq('user_id', u[adminUser].id));
    r = await call(meRoute.GET, adminUser, 'GET');
    check('a Suspended admin is refused (403 not_platform_admin)', r.status === 403 && r.body.code === 'not_platform_admin', r);
    g.__onecityAdmins?.clear();
    must(await d.from('platform_admins').update({ status: 'Active', role_id: null }).eq('user_id', u[adminUser].id));
    r = await call(meRoute.GET, adminUser, 'GET');
    check('an admin with no role is refused', r.status === 403, r);
    g.__onecityAdmins?.clear();
    r = await call(meRoute.GET, 0, 'GET');
    check('a rider who is not an admin is refused', r.status === 403, r);

    // ---- SRV-5: only the active super_admin role is a platform admin; a platform_admins table that cannot be read lets nobody in ----
    const limited = must(await d.from('platform_roles').insert({ key: 'zz_support_ro', name: 'ZZ Support (checks)', permissions: 'orgs:view', is_active: true }).select('id'))[0];
    must(await d.from('platform_admins').update({ status: 'Active', role_id: limited.id }).eq('user_id', u[adminUser].id));
    g.__onecityAdmins?.clear();
    r = await call(meRoute.GET, adminUser, 'GET');
    check('SRV-5: an Active admin on a limited role is refused (the database counts only super_admin as a platform admin)', r.status === 403 && r.body.code === 'not_platform_admin', r);
    must(await d.from('platform_admins').update({ role_id: role.id }).eq('user_id', u[adminUser].id));
    g.__onecityAdmins?.clear();
    r = await call(meRoute.GET, adminUser, 'GET');
    check('SRV-5: the same admin on super_admin is let in, reading and writing', r.status === 200 && r.body.role === 'super_admin' && r.body.can_write === true, r);
    // The lookup fails (a column the code expects is gone, or the database is down): refused with 503, and the failure is not remembered.
    g.__onecityAdmins?.clear();
    const realFrom = d.from.bind(d);
    (d as any).from = (table: string) => table === 'platform_admins'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '42703', message: 'column platform_admins.email does not exist' } }) }) }) }
      : realFrom(table);
    r = await call(meRoute.GET, adminUser, 'GET');
    check('SRV-5: when the platform_admins lookup fails nobody is let in: 503 admin_unavailable, not a 500 and not access', r.status === 503 && r.body.code === 'admin_unavailable', r);
    (d as any).from = realFrom;
    r = await call(meRoute.GET, adminUser, 'GET');
    check('SRV-5: ...and once the table can be read again access returns at once (the failure was not cached)', r.status === 200 && r.body.role === 'super_admin', r);
  } finally {
    await d.from('platform_admins').delete().like('first_name', 'PT').eq('last_name', 'Admin');
    await d.from('platform_roles').delete().eq('key', 'zz_support_ro');
    if (riderIds.length) await d.from('riders').delete().in('id', riderIds); // push_tokens cascade
  }
  console.log(`${passed} checks passed`);
}
main().catch(e => { console.error(e); process.exit(1); });
