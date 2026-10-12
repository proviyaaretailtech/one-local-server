// Pop-up routes through the real route files against the LOCAL Supabase: the seeded Latur demo pop-up is listed for home,
// never for a blocked screen, bad input gets {detail, code}, and an event is recorded under the hashed device key.
// Refuses anything but localhost. Events are append-only, so the one impression it records stays (device key starts "zzpopup").
// Run from frontend/:  npx tsx scripts/popups-checks.ts   (needs frontend/.env.localdb.off and migration 0330)
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
for (const line of readFileSync(`${process.cwd()}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };
const DEMO = '0330d000-0000-4000-8000-000000000001';

async function main() {
  const { db } = await import('../server/db');
  const { sha256 } = await import('../server/http');
  const list = await import('../app/api/popups+api');
  const events = await import('../app/api/popups/[id]/events+api');
  const device = `zzpopup${randomBytes(16).toString('hex')}`;
  const get = async (qs: string) => { const res = await (list as any).GET(new Request(`http://localhost/api/popups?${qs}`), {}); return { status: res.status, body: await res.json() }; };
  const post = async (id: string, body: unknown, key: string | null = device) => {
    const res = await (events as any).POST(new Request(`http://localhost/api/popups/${id}/events`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-customer-key': key } : {}) }, body: JSON.stringify(body) }), { id });
    return { status: res.status, body: await res.json() };
  };

  const home = await get('city=latur&screen=home&lang=hi');
  const demo = home.body.popups?.find((p: { id: string }) => p.id === DEMO);
  check('GET home lists the seeded Navratri demo pop-up', home.status === 200 && !!demo && demo.format === 'popup_center' && demo.frequency === 'daily' && demo.content.en.cta_route === '/collection/festive', home);
  check('GET does not leak targeting', demo && !('targeting' in demo));
  for (const s of ['cart', 'sign-in', 'payment-result', 'order', 'checkout']) check(`GET ${s} is always empty`, (await get(`city=latur&screen=${s}`)).body.popups?.length === 0);
  check('GET another screen does not get a home-only pop-up', !(await get('city=latur&screen=category')).body.popups?.some((p: { id: string }) => p.id === DEMO));
  const bad = await get('city=latur&screen=%3Cscript%3E');
  check('GET bad screen -> 400 {detail, code}', bad.status === 400 && typeof bad.body.detail === 'string' && bad.body.code === 'invalid_screen', bad);
  check('GET unknown city -> 404', (await get('city=pune&screen=home')).status === 404);

  const before = (await db().from('ol_popup_events').select('id', { count: 'exact', head: true }).eq('popup_id', DEMO)).count ?? 0;
  const ok = await post(DEMO, { event: 'impression' });
  check('POST impression -> 201', ok.status === 201 && ok.body.ok === true, ok);
  const { data: rows } = await db().from('ol_popup_events').select('customer_key_hash, event').eq('popup_id', DEMO).order('id', { ascending: false }).limit(1);
  const after = (await db().from('ol_popup_events').select('id', { count: 'exact', head: true }).eq('popup_id', DEMO)).count ?? 0;
  check('the event row is stored with the sha256 of the device key, never the key', after === before + 1 && rows?.[0]?.customer_key_hash === await sha256(device) && rows?.[0]?.event === 'impression', rows);
  const badEvent = await post(DEMO, { event: 'swipe' });
  check('POST unknown event -> 400 {detail, code}', badEvent.status === 400 && badEvent.body.code === 'invalid_event', badEvent);
  check('POST unknown pop-up -> 404', (await post(crypto.randomUUID(), { event: 'tap' })).status === 404);
  check('POST without a device key -> 401', (await post(DEMO, { event: 'tap' }, null)).status === 401);
  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
}
main().catch(e => { console.error(e); process.exit(1); });
