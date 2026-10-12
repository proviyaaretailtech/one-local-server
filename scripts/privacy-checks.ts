// Checks the privacy server (DPDP Act: download, consents, erasure, grievances, nominee) with no
// database (memory mode) and Supabase Auth simulated: each person sees only their own data, consents
// only ever append, erasure removes or anonymises what it should and keeps amounts and taxes, and
// the audit log never carries personal data.
// Run from frontend/:  npx tsx scripts/privacy-checks.ts
for (const k of ['SUPABASE_SERVICE_ROLE_KEY', 'PRIVACY_HARD_DELETE', 'FEATURE_ONLINE_PAYMENTS']) delete process.env[k];
// Sign-in is simulated (below); with no service-role key the server stays in memory mode.
// auth.test is a made-up REMOTE host that stands in for Supabase Auth, so ALLOW_REMOTE=1 is needed for the server to talk to it at all (SEC-1).
Object.assign(process.env, { SUPABASE_URL: 'https://auth.test', SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key', ALLOW_REMOTE: '1' });

const ASHA = { id: '0a5e1a00-0000-4000-8000-00000000a5a1', token: 'token-asha-0123456789abcdef', device: 'device-asha-000000000000000000', email: 'asha@example.com', phone: '919876543210', name: 'Asha Patil' };
const RAVI = { id: '0a5e1a00-0000-4000-8000-00000000fa71', token: 'token-ravi-0123456789abcdef', device: 'device-ravi-000000000000000000', email: 'ravi@example.com', phone: '919812345678', name: 'Ravi Kale' };
const MEERA = { id: '0a5e1a00-0000-4000-8000-0000000e3e7a', token: 'token-meera-0123456789abcdef', device: 'device-meera-00000000000000000', email: 'meera@example.com', phone: '919800000000', name: 'Meera Joshi' };
const NEWA = { id: '0a5e1a00-0000-4000-8000-0000000ae111', token: 'token-newa-0123456789abcdef', device: 'device-newa-000000000000000000', email: 'newa@example.com', phone: '919800000111', name: 'Neha Pawar' };
const NEWB = { id: '0a5e1a00-0000-4000-8000-0000000ae222', token: 'token-newb-0123456789abcdef', device: 'device-newb-000000000000000000', email: 'newb@example.com', phone: '919800000222', name: 'Nitin Pawar' };
const people = [ASHA, RAVI, MEERA, NEWA, NEWB];
const logouts: string[] = [];

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const auth = new Headers(init?.headers).get('authorization') ?? '';
  const who = people.find(p => auth === `Bearer ${p.token}`);
  if (url === 'https://auth.test/auth/v1/user') {
    if (!who) return new Response('{}', { status: 401 });
    return Response.json({ id: who.id, email: who.email, phone: who.phone, created_at: '2026-09-01T10:00:00Z', last_sign_in_at: '2026-09-27T09:00:00Z', user_metadata: { full_name: who.name }, app_metadata: { providers: ['email'] } });
  }
  if (url === 'https://auth.test/auth/v1/logout?scope=global' && init?.method === 'POST') { if (who) logouts.push(who.id); return new Response(null, { status: 204 }); }
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

// The audit log is captured to prove it never carries personal data.
const auditLines: string[] = [];
const info = console.info;
console.info = (...args: unknown[]) => { auditLines.push(args.map(String).join(' ')); };

let passed = 0;
function check(what: string, ok: boolean, detail?: unknown) {
  if (!ok) { console.error(`FAIL  ${what}`, detail ?? ''); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
}
async function refused(what: string, status: number, run: () => Promise<unknown>) {
  try { await run(); check(what, false, 'was accepted'); }
  catch (e) { const s = (e as { status?: number }).status; check(what, s === status, `${s} ${(e as Error).message}`); }
}

type Who = typeof ASHA;
const request = (path: string, body: unknown, who: Who | null, { signedIn = true, device = who?.device } = {}) => new Request(`http://localhost/api/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: {
    'content-type': 'application/json',
    ...(device ? { 'x-customer-key': device } : {}),
    ...(who && signedIn ? { authorization: `Bearer ${who.token}` } : {}),
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const address = (who: Who) => ({ label: 'Home', text: `Flat 4, ${who.name} House, Ausa Road, Latur 413512`, lat: 18.4088, lng: 76.5604, notes: `Call ${who.name}` });
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const deepKeys = (value: unknown): string[] => value && typeof value === 'object'
  ? Object.entries(value).flatMap(([k, v]) => [k, ...deepKeys(v)]) : [];

async function main() {
  const store = await import('../server/store');
  const privacy = await import('../server/privacy');
  const { getCatalog } = await import('../server/catalog');
  const { nearestPlace } = await import('../server/geo');
  const event = (await getCatalog()).events[0];
  const town = nearestPlace({ lat: 18.4088, lng: 76.5604 });

  // ---------- Setup: Asha orders as a guest, then signed in; Ravi on his own phone ----------
  const guest = await store.createCheckout(request('checkouts', { items: [{ id: 'p1', qty: 1 }], address: address(ASHA) }, ASHA, { signedIn: false }), 'latur');
  const ashaCheckout = await store.createCheckout(new Request('http://localhost/api/checkouts', {
    method: 'POST', body: JSON.stringify({ items: [{ id: 'p1', qty: 2 }, { id: 'p2', qty: 1 }], address: address(ASHA) }),
    headers: { 'content-type': 'application/json', 'x-customer-key': ASHA.device, authorization: `Bearer ${ASHA.token}`, 'idempotency-key': 'asha-key-0001' },
  }), 'latur');
  await store.createSupportRequest(request('support-requests', { topic: 'order', message: `Asha here, my phone is ${ASHA.phone}, please call` }, ASHA));
  await store.createLaunchRequest(request('launch-requests', { place_id: town.id }, ASHA));
  await store.createEnquiry(request('booking-enquiries', { event_id: event.id, slot: event.slots[0], date: tomorrow(), name: ASHA.name, phone: ASHA.phone.slice(2), guests: 2 }, ASHA));
  const raviCheckout = await store.createCheckout(request('checkouts', { items: [{ id: 'f1', qty: 1 }], address: address(RAVI) }, RAVI), 'latur');
  await store.createSupportRequest(request('support-requests', { topic: 'payment', message: `Ravi asks about a refund for ${RAVI.email}` }, RAVI));
  const ashaOrderIds = [...guest.orders, ...ashaCheckout.orders].map(o => o.id);
  const raviOrderIds = raviCheckout.orders.map(o => o.id);
  check('setup: Asha has 3 store orders (1 as a guest, 2 signed in), Ravi has 1', ashaOrderIds.length === 3 && raviOrderIds.length === 1);

  // ---------- SEC-1: no remote Supabase unless ALLOW_REMOTE=1 ----------
  delete process.env.ALLOW_REMOTE;
  await refused('a remote Supabase is not asked who is signed in without ALLOW_REMOTE=1 (so the token counts as not signed in)', 401, () => privacy.exportMyData(request('privacy/export', undefined, NEWA)));
  process.env.ALLOW_REMOTE = '1';
  check('with ALLOW_REMOTE=1 the same kind of sign-in works', (await privacy.exportMyData(request('privacy/export', undefined, NEWB))).account.email === NEWB.email);

  // ---------- Signed-in only ----------
  await refused('download without signing in is refused (401)', 401, () => privacy.exportMyData(request('privacy/export', undefined, null)));
  await refused('a device key alone is not enough (401)', 401, () => privacy.exportMyData(request('privacy/export', undefined, ASHA, { signedIn: false })));
  await refused('consents need sign-in (401)', 401, () => privacy.recordConsents(request('privacy/consents', { consents: [] }, ASHA, { signedIn: false })));
  await refused('erasure needs sign-in (401)', 401, () => privacy.requestErasure(request('privacy/erasure', { confirm: 'DELETE' }, ASHA, { signedIn: false })));
  await refused('grievances need sign-in (401)', 401, () => privacy.raiseGrievance(request('privacy/grievances', { message: 'Something is wrong here' }, null)));
  await refused('nomination needs sign-in (401)', 401, () => privacy.nominate(request('privacy/nominee', { name: 'X Y', relationship: 'friend', phone: '9800000001' }, null)));

  // ---------- Download: only the caller's data ----------
  const mine = await privacy.exportMyData(request('privacy/export', undefined, ASHA));
  const mineText = JSON.stringify(mine);
  check('download names the account (email, name, phone)', mine.account.email === ASHA.email && mine.account.name === ASHA.name && mine.account.phone === `+${ASHA.phone}`);
  check('download has all 3 of Asha’s orders, guest order included', mine.orders.length === 3 && ashaOrderIds.every(id => mine.orders.some(o => o.id === id)));
  check('download has her checkouts, help request, launch request and booking enquiry',
    mine.checkouts.length === 2 && mine.support_requests.length === 1 && mine.launch_requests.length === 1 && mine.booking_enquiries.length === 1);
  check('download carries the delivery address she gave', mineText.includes(address(ASHA).text));
  check('download contains none of Ravi’s data', !raviOrderIds.some(id => mineText.includes(id)) && !mineText.includes(RAVI.name) && !mineText.includes(RAVI.email));
  check('download leaves out internal keys (hashes, idempotency keys, rider phone)',
    !deepKeys(mine).some(k => ['customer_hash', 'customer', 'idempotency_key', 'rider_phone'].includes(k)));
  check('download explains what we collect, who we share with and what the law keeps',
    mine.what_we_collect_and_why.length > 5 && mine.shared_with.length > 3 && mine.kept_by_law_after_deletion.length > 2);
  check('download gets a reference (EX-…)', /^EX-\d{6}-[A-Z0-9]{6}$/.test(mine.about.reference), mine.about.reference);

  const his = await privacy.exportMyData(request('privacy/export', undefined, RAVI));
  const hisText = JSON.stringify(his);
  check('Ravi’s download has only his order', his.orders.length === 1 && his.orders[0].id === raviOrderIds[0]);
  check('Ravi cannot read Asha’s data (orders, address, messages, enquiry)',
    !ashaOrderIds.some(id => hisText.includes(id)) && !hisText.includes(ASHA.name) && !hisText.includes(ASHA.phone) && his.booking_enquiries.length === 0);
  const ashaOnRavisPhone = await privacy.exportMyData(request('privacy/export', undefined, ASHA, { device: RAVI.device }));
  check('Asha signed in on Ravi’s phone: her account orders, not her own phone’s guest order, and none of Ravi’s',
    ashaOnRavisPhone.orders.length === 2 && !ashaOnRavisPhone.orders.some(o => o.id === guest.orders[0].id || raviOrderIds.includes(o.id as string)));

  // ---------- Consents: append-only, with the notice version ----------
  const { PRIVACY } = await import('../constants/privacy');
  const v = PRIVACY.noticeVersion;
  const first = await privacy.recordConsents(request('privacy/consents', { consents: [
    { purpose: 'notice_acknowledged', granted: true, notice_version: v, source: 'sign_in', at: new Date(Date.now() - 60_000).toISOString() },
    { purpose: 'age_18_plus', granted: true, notice_version: v, source: 'sign_in' },
    { purpose: 'marketing', granted: true, notice_version: v, source: 'sign_in' },
  ] }, ASHA));
  check('consents recorded (3)', first.recorded === 3 && first.stored === 'memory');
  await privacy.recordConsents(request('privacy/consents', { consents: [{ purpose: 'marketing', granted: false, notice_version: v, source: 'privacy_screen' }] }, ASHA));
  const now = await privacy.currentConsents(request('privacy/consents', undefined, ASHA));
  const marketing = now.consents.find(c => c.purpose === 'marketing');
  check('withdrawing marketing is one more record, and it is now off', marketing?.granted === false && now.consents.length === 3);
  const history = (await privacy.exportMyData(request('privacy/export', undefined, ASHA))).consents;
  check('consent history keeps every record (4), each with the notice version', history.length === 4 && history.every(c => c.notice_version === v));
  check('a choice made on the phone earlier keeps that time (given_at)', history.some(c => c.purpose === 'notice_acknowledged' && typeof c.given_at === 'string'));
  check('Ravi has no consents of Asha’s', (await privacy.currentConsents(request('privacy/consents', undefined, RAVI))).consents.length === 0);
  await refused('an unknown purpose is refused', 400, () => privacy.recordConsents(request('privacy/consents', { consents: [{ purpose: 'sell_my_data', granted: true, notice_version: v, source: 'sign_in' }] }, ASHA)));
  await refused('the age confirmation cannot be “withdrawn”', 400, () => privacy.recordConsents(request('privacy/consents', { consents: [{ purpose: 'age_18_plus', granted: false, notice_version: v, source: 'privacy_screen' }] }, ASHA)));
  await refused('a malformed notice version is refused', 400, () => privacy.recordConsents(request('privacy/consents', { consents: [{ purpose: 'marketing', granted: true, notice_version: 'latest', source: 'sign_in' }] }, ASHA)));
  await refused('more than 20 choices at once is refused', 400, () => privacy.recordConsents(request('privacy/consents', { consents: Array(21).fill({ purpose: 'marketing', granted: true, notice_version: v, source: 'sign_in' }) }, ASHA)));

  // ---------- Grievances, corrections, nominee ----------
  const grievance = await privacy.raiseGrievance(request('privacy/grievances', { message: 'I keep getting offers after saying no.', about: 'marketing' }, ASHA));
  const days = (Date.parse(grievance.due_at!) - Date.now()) / 86_400_000;
  check('grievance gets a GR- reference and an answer-by date 90 days out', /^GR-\d{6}-[A-Z0-9]{6}$/.test(grievance.reference) && days > 89.9 && days < 90.1, grievance);
  const correction = await privacy.raiseGrievance(request('privacy/grievances', { kind: 'correction', message: 'My name is spelled wrong on an old order.' }, ASHA));
  check('a correction request gets a CR- reference', /^CR-/.test(correction.reference) && correction.kind === 'correction');
  await refused('a too-short grievance is refused', 400, () => privacy.raiseGrievance(request('privacy/grievances', { message: 'bad' }, ASHA)));
  const nominee = await privacy.nominate(request('privacy/nominee', { name: 'Sunita Patil', relationship: 'parent', phone: '+91 98765 43211' }, ASHA));
  check('nomination gets an NM- reference', /^NM-/.test(nominee.reference));
  await refused('a nominee with no way to reach them is refused', 400, () => privacy.nominate(request('privacy/nominee', { name: 'Sunita Patil', relationship: 'parent' }, ASHA)));
  await refused('a nominee with a bad phone number is refused', 400, () => privacy.nominate(request('privacy/nominee', { name: 'Sunita Patil', relationship: 'parent', phone: '12345' }, ASHA)));
  await refused('an unknown relationship is refused', 400, () => privacy.nominate(request('privacy/nominee', { name: 'Sunita Patil', relationship: 'boss', email: 's@example.com' }, ASHA)));
  const requests = (await privacy.exportMyData(request('privacy/export', undefined, ASHA))).privacy_requests;
  check('her requests are listed in her download (grievance, correction, nominee, downloads)',
    ['grievance', 'correction', 'nominee', 'export'].every(k => requests.some(r => r.kind === k)));

  // ---------- Erasure ----------
  await refused('erasure without the confirm word is refused', 400, () => privacy.requestErasure(request('privacy/erasure', {}, ASHA)));
  await refused('erasure waits while an order is on its way (409)', 409, () => privacy.requestErasure(request('privacy/erasure', { confirm: 'DELETE' }, ASHA)));
  const memory = store.memoryRecords();
  for (const o of memory.orders) if (ashaOrderIds.includes(o.id)) o.status = 'delivered';
  const before = memory.orders.filter(o => ashaOrderIds.includes(o.id)).map(o => ({ id: o.id, total: o.total, gst: o.gst, subtotal: o.subtotal, items: JSON.stringify(o.items) }));
  const erased = await privacy.requestErasure(request('privacy/erasure', { confirm: 'DELETE' }, ASHA));
  check('erasure answers with an ER- reference, counts and what the law keeps',
    /^ER-/.test(erased.reference) && erased.erased.orders_anonymised === 3 && erased.erased.checkouts_anonymised === 2 && erased.kept.length > 2, erased);
  check('with hard delete off, the login is kept for review and every session is ended', erased.login === 'kept_for_review' && erased.status === 'partially_completed' && logouts.includes(ASHA.id));
  const after = memory.orders.filter(o => ashaOrderIds.includes(o.id));
  check('orders stay for tax records: same totals, GST and items', after.length === 3 && before.every(b => {
    const a = after.find(o => o.id === b.id)!; return a.total === b.total && a.gst === b.gst && a.subtotal === b.subtotal && JSON.stringify(a.items) === b.items;
  }));
  check('orders no longer carry her address or point to her', after.every(o => o.address === null && o.user_id === null && o.customer.startsWith('erased:')));
  check('checkouts no longer point to her', memory.checkouts.filter(c => c.id === ashaCheckout.id || c.id === guest.id).every(c => c.user_id === null && c.customer.startsWith('erased:')));
  check('her booking enquiry is deleted', !memory.enquiries.some(e => e.name === ASHA.name));
  check('her help message is replaced; the town she asked for still counts, unlinked',
    !memory.support.some(s => s.message.includes(ASHA.phone)) && memory.support.some(s => s.reference === `launch:${town.id}` && s.user_id === null && s.customer === null));
  check('the remembered copy of her checkout (with her address) is gone', ![...memory.replies.keys()].some(k => k.endsWith(':asha-key-0001')));
  const afterwards = await privacy.exportMyData(request('privacy/export', undefined, ASHA));
  check('after erasure her download holds no orders, messages or enquiries',
    afterwards.orders.length === 0 && afterwards.support_requests.length === 0 && afterwards.booking_enquiries.length === 0 && !JSON.stringify(afterwards).includes(address(ASHA).text));
  check('her optional consents are withdrawn; the history is kept as evidence',
    ['marketing', 'personalisation', 'location_suggestions'].every(p => afterwards.consents.some(c => c.purpose === p && c.granted === false)) && afterwards.consents.length === 7);
  check('the erasure request itself is kept, with its outcome', afterwards.privacy_requests.some(r => r.kind === 'erasure' && r.reference === erased.reference));
  const ravi = memory.orders.find(o => o.id === raviOrderIds[0])!;
  check('Ravi’s order is untouched', ravi.user_id === RAVI.id && ravi.address?.text === address(RAVI).text);
  check('Ravi’s help request is untouched', memory.support.some(s => s.user_id === RAVI.id && s.message.includes(RAVI.email)));

  process.env.PRIVACY_HARD_DELETE = 'on';
  ravi.status = 'delivered';
  const noDb = await privacy.requestErasure(request('privacy/erasure', { confirm: 'DELETE' }, RAVI));
  check('PRIVACY_HARD_DELETE=on never claims a deleted login without the database', noDb.login === 'kept_for_review');
  delete process.env.PRIVACY_HARD_DELETE;

  // ---------- Rate limit ----------
  for (let i = 0; i < 5; i++) await privacy.exportMyData(request('privacy/export', undefined, MEERA));
  await refused('the 6th download in an hour is refused (429)', 429, () => privacy.exportMyData(request('privacy/export', undefined, MEERA)));

  // ---------- Audit log: no personal data ----------
  const log = auditLines.filter(l => l.startsWith('[privacy]')).join('\n');
  const secrets = [ASHA.id, RAVI.id, ASHA.email, RAVI.email, ASHA.name, RAVI.name, ASHA.phone.slice(2), 'Sunita', 'Ausa Road', 'offers after saying no', ASHA.token];
  check('every privacy action is audit-logged', ['export', 'consents', 'grievance', 'correction', 'nominee', 'erasure_started', 'erasure_done'].every(e => log.includes(`"event":"${e}"`)));
  check('the audit log carries no ids, names, phones, emails, addresses, messages or tokens', secrets.every(s => !log.includes(s)), secrets.filter(s => log.includes(s)));

  // ---------- Routes ----------
  const route = await import('../app/api/privacy/export+api');
  const answer = await route.GET(request('privacy/export', undefined, null), {});
  check('GET /api/privacy/export answers 401 with a message when signed out', answer.status === 401 && typeof (await answer.json()).detail === 'string');
  for (const name of ['consents', 'erasure', 'grievances', 'nominee']) await import(`../app/api/privacy/${name}+api`);
  check('privacy route modules import cleanly', true);

  console.info = info;
  console.log(`\n${passed} checks passed.`);
}

main().catch(e => { console.info = info; console.error(e); process.exitCode = 1; });
