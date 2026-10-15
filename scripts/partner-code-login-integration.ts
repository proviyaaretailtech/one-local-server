// Partner code sign-in (specs/partner-code-sign-in, database migration 0345), through the real route against the LOCAL Supabase and its
// real auth service: a partner "signs up" (login + application + store made at sign-up), types the code, gets a session, and the
// partner API shows them their own store. Also: wrong codes, the lock, a code that belongs to an account that already existed.
// Refuses anything but localhost and removes what it creates (attempt records are append-only evidence and stay).
//   Run from frontend/:  npx tsx scripts/partner-code-login-integration.ts
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
for (const line of readFileSync(`${process.cwd()}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');
process.env.TRUSTED_PROXY_HOPS = '1'; // each scenario gets its own caller address through x-forwarded-for

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };

async function main() {
  const { db } = await import('../server/db');
  const { createClient } = await import('@supabase/supabase-js');
  const login = await import('../app/api/partner/code-login+api');
  const me = await import('../app/api/partner/me+api');
  const outlet = await import('../app/api/partner/outlet+api');
  const d = db();
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
  const RUN = randomBytes(4).toString('hex');
  const made = { users: [] as string[], apps: [] as string[] };
  const appKey = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)!;
  const anon = () => createClient(process.env.SUPABASE_URL!, appKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let ipCounter = 0;
  const callerIp = () => `198.51.${Number(`0x${RUN.slice(0, 2)}`)}.${++ipCounter}`;
  const post = async (code: unknown, from: string) => {
    const r: Response = await login.POST(new Request('http://localhost/api/partner/code-login', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': from }, body: JSON.stringify({ code }),
    }), {});
    return { status: r.status, retry: r.headers.get('retry-after'), json: await r.json().catch(() => null) };
  };

  // what the website does at the end of the sign-up
  const signUp = async (label: string, opts: { confirmed?: boolean; phone: string }) => {
    const email = `code.${label}.${RUN}@proviyaa.test`, password = randomBytes(18).toString('base64url');
    const u = await d.auth.admin.createUser({ email, password, email_confirm: opts.confirmed !== false });
    if (u.error || !u.data.user) throw new Error(`createUser: ${u.error?.message}`);
    made.users.push(u.data.user.id);
    const id = randomUUID();
    const ref = `OLP-${randomBytes(4).toString('hex').toUpperCase()}`;
    must(await d.from('ol_partner_applications').insert({
      id, reference: ref, city_id: 'latur', business_name: `Code ${label} ${RUN}`, business_type: 'restaurant', partner_type: 'restaurant', address: 'Gandhi Chowk, Latur',
      pin_code: '413512', owner_name: 'Asha Patil', phone: opts.phone, email, consent_version: 'v1', consent_at: new Date().toISOString(), submit_key: `ck-${label}-${RUN}`,
      status: 'submitted', category: 'Restaurants', categories: ['Restaurants'],
    }));
    made.apps.push(id);
    const attach = must(await d.rpc('ol_partner_application_attach_login', { p_reference: ref, p_user: u.data.user.id }));
    return { email, password, ref, appId: id, userId: u.data.user.id, attach };
  };

  try {
    const phone = () => `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const a = await signUp('a', { phone: phone() });
    check('sign-up: the login is linked and a Pending store is made', a.attach.linked === true && a.attach.provisioned === true && !!a.attach.organization_id, a.attach);
    const org = must(await d.from('organizations').select('control_status, contact_email').eq('id', a.attach.organization_id).single());
    check('the store is Pending and carries the applicant email', org.control_status === 'Pending' && org.contact_email === a.email, org);

    // the right code, any case, with or without the dash
    const from1 = callerIp();
    let r = await post(a.ref.toLowerCase().replace('-', ' '), from1);
    check('the right code (typed lower case with a space) gives a sign-in token', r.status === 200 && typeof r.json?.token_hash === 'string' && r.json?.email === a.email && r.json?.organization_id === a.attach.organization_id && r.json?.application_status === 'submitted', r);
    
    // the token becomes a session for that very login
    const client = anon();
    const verified = await client.auth.verifyOtp({ token_hash: r.json.token_hash, type: 'magiclink' });
    check('the token becomes a session for the partner', !verified.error && verified.data.user?.id === a.userId && !!verified.data.session?.access_token, verified.error?.message);
    const again = await anon().auth.verifyOtp({ token_hash: r.json.token_hash, type: 'magiclink' });
    check('the token works once', !!again.error, again.data?.user?.id);

    // the partner API shows the partner their own store
    const token = verified.data.session!.access_token;
    const meRes: Response = await me.GET(new Request('http://localhost/api/partner/me', { headers: { authorization: `Bearer ${token}` } }), {});
    const meJson = await meRes.json();
    check('/api/partner/me opens straight into the new store (owner, not set up for orders, outlet closed)', meRes.status === 200 && meJson.person?.organization_id === a.attach.organization_id && meJson.person?.role === 'org_owner' && meJson.restaurant?.accepting === false, meJson);
    check('/me says the store is waiting for approval (the app shows a banner)', meJson.restaurant?.approval_status === 'pending', meJson.restaurant);
    const toggle: Response = await outlet.PATCH(new Request('http://localhost/api/partner/outlet', { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ accepting: true }) }), {});
    const toggleJson = await toggle.json();
    check('the partner API refuses to open ordering on a store waiting for approval (409 not_approved)', toggle.status === 409 && toggleJson.code === 'not_approved', { status: toggle.status, toggleJson });
    const turnOn = await d.from('ol_merchant_channels').update({ accepting: true }).eq('organization_id', a.attach.organization_id);
    check('a Pending store cannot switch One Local ordering on', !!turnOn.error && /OL_NOT_APPROVED/.test(turnOn.error.message), turnOn.error?.message);

    // someone who only knows the phone number must not learn the code (review F1)
    const { submitPartnerApplication } = await import('../server/partner-applications');
    const known = must(await d.from('ol_partner_applications').select('phone, city_id').eq('id', a.appId).single());
    const probe = await submitPartnerApplication(new Request('http://localhost/api/partner-applications', { headers: { 'x-forwarded-for': callerIp() } }), {
      stage: 'submit', partner_type: 'restaurant', business_name: 'Mallory Shop', owner_name: 'Mallory', phone: known.phone, email: `mallory.${RUN}@proviyaa.test`,
      consent: true, address: 'Other Road, Latur', pin_code: '413512', subcategories: ['Indian'],
      outlets: '1', services: ['delivery'], password: 'Mallory2026x', submit_key: `ck-mallory-${RUN}-0001`,
    }).catch(e => ({ error: e?.detail ?? String(e) } as any));
    check('a second application with a known phone number is answered "existing" with NO reference', (probe as any).existing === true && !(probe as any).reference, probe);

    // wrong codes
    const from2 = callerIp();
    r = await post('OLP-00000000', from2);
    check('a wrong code: 401 invalid_code, generic words', r.status === 401 && r.json?.code === 'invalid_code' && !/expired|used|exist/i.test(r.json?.detail ?? ''), r);
    r = await post('not a code', from2);
    check('a malformed code answers the same way', r.status === 401 && r.json?.code === 'invalid_code', r);
    r = await post('', from2);
    check('an empty code: 400', r.status === 400, r);
    r = await post(12345, from2);
    check('a code that is not text: 400', r.status === 400, r);

    // an application can only take the login that has its own email: a code can never reach someone else's account
    const old = await d.auth.admin.createUser({ email: `code.old.${RUN}@proviyaa.test`, password: randomBytes(18).toString('base64url'), email_confirm: true });
    made.users.push(old.data.user!.id);
    const oldAppId = randomUUID(), oldRef = `OLP-${randomBytes(4).toString('hex').toUpperCase()}`;
    must(await d.from('ol_partner_applications').insert({
      id: oldAppId, reference: oldRef, city_id: 'latur', business_name: `Code old ${RUN}`, business_type: 'restaurant', partner_type: 'restaurant', address: 'Gandhi Chowk, Latur',
      pin_code: '413512', owner_name: 'Asha Patil', phone: phone(), email: `code.old.${RUN}@proviyaa.test`, consent_version: 'v1', consent_at: new Date().toISOString(), submit_key: `ck-old-${RUN}`,
      status: 'submitted', category: 'Restaurants', categories: ['Restaurants'],
    }));
    made.apps.push(oldAppId);
    const stranger = await d.rpc('ol_partner_application_attach_login', { p_reference: oldRef, p_user: a.userId });
    check('a login with another email cannot be attached to an application', !!stranger.error && /OL_BAD_REQUEST/.test(stranger.error.message), stranger.error?.message);

    // the lock: eight wrong tries from one address, then even the right code is refused from it
    const from3 = callerIp();
    for (let i = 0; i < 8; i++) await post(`OLP-BAD0000${i}`, from3);
    r = await post(a.ref, from3);
    check('after 8 wrong tries the address is locked: 429 code_locked with Retry-After, even for the right code', r.status === 429 && r.json?.code === 'code_locked' && Number(r.retry) >= 60, r);
    r = await post(a.ref, callerIp());
    check('another address still signs in', r.status === 200 && typeof r.json?.token_hash === 'string', r);
    const attempts = must(await d.from('ol_partner_code_attempts').select('result').order('id', { ascending: false }).limit(40));
    check('the attempts are recorded (ok, unknown, locked)', ['ok', 'unknown', 'locked'].every(x => attempts.some((y: any) => y.result === x)), attempts.map((x: any) => x.result));

    // approval opens the same store
    const staff = must(await d.from('platform_admins').select('user_id').eq('status', 'Active').limit(1));
    if (staff[0]) {
      const dec = must(await d.rpc('master_partner_application_decide', { p_id: a.appId, p_decision: 'approve', p_reason: 'checked on the call', p_actor: staff[0].user_id }));
      check('approving opens the store made at sign-up (same organisation)', dec.organization_id === a.attach.organization_id && dec.status === 'approved', dec);
      const meAfter: Response = await me.GET(new Request('http://localhost/api/partner/me', { headers: { authorization: `Bearer ${token}` } }), {});
      check('/me no longer says pending after approval', (await meAfter.json()).restaurant?.approval_status === 'approved');
      r = await post(a.ref, callerIp());
      check('the code still signs in after approval', r.status === 200 && r.json?.application_status === 'approved', r);
    } else console.log('skip  approve: no active platform admin in this database');
  } finally {
    // A decided application (and the store it names) is a record the app cannot delete, so this dev-only cleanup runs inside the local
    // database with the triggers lifted for that one transaction (the same idea as database/purge_test_orders.sh).
    if (made.apps.length) {
      const ids = made.apps.map(id => `'${id}'`).join(',');
      try {
        execFileSync('docker', ['exec', '-i', 'supabase_db_onelocal-dev', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: `
begin;
set local session_replication_role = replica;
create temp table _o on commit drop as select organization_id as id from public.ol_partner_applications where id in (${ids}) and organization_id is not null;
delete from public.ol_partner_applications where id in (${ids});
delete from public.ol_merchant_channels where organization_id in (select id from _o);
delete from public.org_users where organization_id in (select id from _o);
delete from public.audit_logs where organization_id in (select id from _o) or entity_id in (${made.apps.map(id => `'${id}'`).join(',')});
delete from public.organizations where id in (select id from _o);
commit;`, stdio: ['pipe', 'ignore', 'inherit'] });
      } catch (e) { console.warn('cleanup failed:', (e as Error).message.slice(0, 200)); }
    }
    for (const u of made.users) await d.auth.admin.deleteUser(u);
  }
  console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
}

main().catch(e => { console.error(e); process.exit(1); });
