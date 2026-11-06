// Reels run from Master Admin (specs/reels-admin/spec.md) and the per-feature access Master grants, through the real route files against
// the LOCAL Supabase: who may see and change reels (super admin, a role with the reels feature, view only, a pop-ups-only role), create /
// edit / pause / show / order / delete, the link and media rules, the upload folder, and what customers then get from GET /api/reels.
// Refuses anything but localhost. Everything it makes (two test users, three roles, its reels) is removed at the end.
// Run from frontend/:  npx tsx scripts/reels-admin-checks.ts   (needs frontend/.env.local pointing at the local stack and migration 0642)
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
for (const line of readFileSync(`${process.cwd()}/.env.local`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };
type Route = (request: Request, params: Record<string, string>) => Response | Promise<Response>;

async function main() {
  const { db } = await import('../server/db');
  const admin = await import('../server/admin');
  const list = await import('../app/api/admin/reels/index+api') as unknown as Record<string, Route>;
  const one = await import('../app/api/admin/reels/[id]/index+api') as unknown as Record<string, Route>;
  const status = await import('../app/api/admin/reels/[id]/status+api') as unknown as Record<string, Route>;
  const order = await import('../app/api/admin/reels/order+api') as unknown as Record<string, Route>;
  const options = await import('../app/api/admin/reels/options+api') as unknown as Record<string, Route>;
  const upload = await import('../app/api/admin/media/upload-url+api') as unknown as Record<string, Route>;
  const popups = await import('../app/api/admin/popups/index+api') as unknown as Record<string, Route>;
  const customer = await import('../app/api/reels+api') as unknown as Record<string, Route>;

  // ---------- grants(): the same reading of a role as Master Admin ----------
  const F = admin.REELS_FEATURE;
  check('grants: full + both actions may see and change', admin.grants('feat_customer_reels::full::view_reels$manage_reels', F, false) && admin.grants('feat_customer_reels::full::view_reels$manage_reels', F, true));
  check('grants: read_only + view may see, not change', admin.grants('feat_x::full::a$$$feat_customer_reels::read_only::view_reels', F, false) && !admin.grants('feat_customer_reels::read_only::view_reels$manage_reels', F, true));
  check('grants: another feature, no level or no action gives nothing', !admin.grants('feat_customer_popups::full::view_popups$manage_popups', F, false)
    && !admin.grants('feat_customer_reels::none::view_reels', F, false) && !admin.grants('feat_customer_reels::full::', F, false) && !admin.grants('', F, false));
  const row = (role: unknown) => ({ user_id: 'u1', status: 'Active', first_name: 'A', last_name: null, platform_roles: role }) as never;
  check('staffFromRow: a limited role keeps its permissions and cannot write by itself', admin.staffFromRow(row({ key: 'marketing', is_active: true, permissions: 'p' }), null)?.permissions === 'p'
    && admin.staffFromRow(row({ key: 'marketing', is_active: true, permissions: 'p' }), null)?.canWrite === false);
  check('staffFromRow: a deactivated role is nobody; adminFromRow still means super admin only', admin.staffFromRow(row({ key: 'marketing', is_active: false, permissions: 'p' }), null) === null
    && admin.adminFromRow(row({ key: 'marketing', is_active: true, permissions: 'p' }), null) === null && admin.adminFromRow(row({ key: 'super_admin', is_active: true }), null)?.canWrite === true);

  // ---------- fixtures: a manager, a viewer and a pop-ups-only staff member ----------
  const tag = randomBytes(4).toString('hex');
  const made: { users: string[]; roles: string[]; reels: string[] } = { users: [], roles: [], reels: [] };
  const person = async (perms: string) => {
    const email = `zzreels-${tag}-${made.users.length}@local.test`, password = randomBytes(18).toString('base64url');
    const { data: u, error } = await db().auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !u.user) throw new Error(`createUser: ${error?.message}`);
    made.users.push(u.user.id);
    const { data: role, error: re } = await db().from('platform_roles').insert({ name: `zz reels ${tag} ${made.roles.length}`, key: `zz_reels_${tag}_${made.roles.length}`, permissions: perms }).select('id').single();
    if (re) throw new Error(`role: ${re.message}`);
    made.roles.push(role.id);
    const { error: pe } = await db().from('platform_admins').insert({ user_id: u.user.id, role_id: role.id, status: 'Active', first_name: 'Reels', last_name: 'Check' });
    if (pe) throw new Error(`platform_admins: ${pe.message}`);
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: process.env.SUPABASE_ANON_KEY ?? '', 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const body = await res.json() as { access_token?: string };
    if (!body.access_token) throw new Error('sign-in failed');
    return body.access_token;
  };
  const call = async (mod: Record<string, Route>, method: string, path: string, token: string | null, body?: unknown, params: Record<string, string> = {}) => {
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await mod[method](new Request(`http://localhost:8081/api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), params);
    const text = await res.text();
    let json: any = text; try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json };
  };
  try {
    const manager = await person('feat_customer_reels::full::view_reels$manage_reels');
    const viewer = await person('feat_customer_reels::read_only::view_reels');
    const popupsOnly = await person('feat_customer_popups::full::view_popups$manage_popups');

    // ---------- who may do what ----------
    check('not signed in: 401', (await call(list, 'GET', 'admin/reels', null)).status === 401);
    const listed = await call(list, 'GET', 'admin/reels', viewer);
    check('a view-only role lists reels, with the sample reels shown', listed.status === 200 && Array.isArray(listed.body) && listed.body.some((r: any) => r.id === 'r-amul' && r.shown === 'shown'), listed.body);
    const viewerWrite = await call(list, 'POST', 'admin/reels', viewer, {});
    check('a view-only role cannot add a reel: 403 read_only_role', viewerWrite.status === 403 && viewerWrite.body.code === 'read_only_role', viewerWrite.body);
    const other = await call(list, 'GET', 'admin/reels', popupsOnly);
    check('a pop-ups-only role cannot see reels: 403 feature_not_granted', other.status === 403 && other.body.code === 'feature_not_granted', other.body);
    check('a pop-ups-only role can list pop-ups (Master grants reach One Local)', (await call(popups, 'GET', 'admin/popups', popupsOnly)).status === 200);
    check('a reels role cannot list pop-ups', (await call(popups, 'GET', 'admin/popups', manager)).status === 403);

    // ---------- pickers and uploads ----------
    const opts = await call(options, 'GET', 'admin/reels/options?city=latur&q=amul', manager);
    check('options: cities, products matching the search, brands', opts.status === 200 && opts.body.cities.some((c: any) => c.id === 'latur') && opts.body.products.length > 0
      && opts.body.products.every((p: any) => `${p.name} ${p.brand ?? ''}`.toLowerCase().includes('amul')) && opts.body.brands.some((b: any) => b.id === 'amul'), opts.body);
    const up = await call(upload, 'POST', 'admin/media/upload-url', manager, { folder: 'reels', filename: 'diwali.mp4', content_type: 'video/mp4', size: 30 * 1024 * 1024 });
    check('upload: a reels role gets a link into reels/ for a 30 MB MP4', up.status === 200 && /\/reels\/\d{4}\/\d{2}\/[0-9a-f]{16}-diwali\.mp4$/.test(up.body.path ? `/${up.body.path}` : '') && up.body.max_bytes === 40 * 1024 * 1024, up.body);
    check('upload: over 40 MB is refused', (await call(upload, 'POST', 'admin/media/upload-url', manager, { folder: 'reels', filename: 'big.mp4', content_type: 'video/mp4', size: 41 * 1024 * 1024 })).status === 413);
    check('upload: a reels role cannot upload into pop-ups or stores', (await call(upload, 'POST', 'admin/media/upload-url', manager, { folder: 'popups', filename: 'a.jpg', content_type: 'image/jpeg' })).status === 403
      && (await call(upload, 'POST', 'admin/media/upload-url', manager, { folder: 'stores', filename: 'a.jpg', content_type: 'image/jpeg' })).status === 403);
    check('upload: a view-only role cannot upload', (await call(upload, 'POST', 'admin/media/upload-url', viewer, { folder: 'reels', filename: 'a.jpg', content_type: 'image/jpeg' })).status === 403);
    const video = up.body.public_url as string;

    // ---------- create, rules ----------
    const draft = { city_id: 'latur', product_id: 'a3', video, poster: video.replace(/\.mp4$/, '.jpg'), caption: `Reels check ${tag}`, tag: 'CHECK' };
    const made1 = await call(list, 'POST', 'admin/reels', manager, draft);
    check('create: 201, active, not a sample, shown as the brand while no creator is typed', made1.status === 201 && made1.body.status === 'active' && made1.body.is_demo === false && made1.body.creator === null && !!made1.body.display_creator && made1.body.shown === 'shown', made1.body);
    if (made1.body?.id) made.reels.push(made1.body.id);
    const brandOnly = await call(list, 'POST', 'admin/reels', manager, { city_id: 'latur', brand_id: 'nivea', video, caption: `Brand reel ${tag}`, status: 'paused' });
    check('create: a brand-only reel can start paused', brandOnly.status === 201 && brandOnly.body.status === 'paused' && brandOnly.body.product === null && brandOnly.body.shown === 'paused', brandOnly.body);
    if (brandOnly.body?.id) made.reels.push(brandOnly.body.id);
    check('create: no product and no brand is refused', (await call(list, 'POST', 'admin/reels', manager, { city_id: 'latur', video })).body.detail === 'Link the reel to a product, a brand, or both');
    check('create: a product this city does not have is refused', (await call(list, 'POST', 'admin/reels', manager, { ...draft, product_id: 'nope' })).body.code === 'unknown_product');
    check('create: a video from another website is refused', (await call(list, 'POST', 'admin/reels', manager, { ...draft, video: 'https://evil.example.com/a.mp4' })).status === 400);
    check('create: an unknown field is refused', (await call(list, 'POST', 'admin/reels', manager, { ...draft, likes: 9999 })).status === 400);
    check('create: the end must be after the start', (await call(list, 'POST', 'admin/reels', manager, { ...draft, starts_at: '2026-11-02T10:00:00+05:30', ends_at: '2026-11-01T10:00:00+05:30' })).body.detail === 'The end must be after the start');

    const feed = async () => (await call(customer, 'GET', 'reels?city=latur', null)).body as any[];
    let customers = await feed();
    const mine = customers.find(r => r.id === made1.body.id);
    check('customers see the new reel with its own video for the web, its poster and its product', !!mine && mine.video_web === video && mine.poster === draft.poster && mine.product?.id === 'a3' && mine.is_demo === false, mine);
    check('customers do not see the paused brand reel', !customers.some(r => r.id === brandOnly.body.id));

    // ---------- edit, pause, show, order, window, delete ----------
    const edited = await call(one, 'PUT', `admin/reels/${made1.body.id}`, manager, { ...draft, caption: `Edited ${tag}`, creator: 'OneLocal Fresh' }, { id: made1.body.id });
    check('edit: caption and creator change', edited.status === 200 && edited.body.caption === `Edited ${tag}` && edited.body.creator === 'OneLocal Fresh', edited.body);
    check('edit: a view-only role cannot edit', (await call(one, 'PUT', `admin/reels/${made1.body.id}`, viewer, draft, { id: made1.body.id })).status === 403);
    await call(status, 'POST', `admin/reels/${made1.body.id}/status`, manager, { status: 'paused' }, { id: made1.body.id });
    check('pause: customers stop seeing it', !(await feed()).some(r => r.id === made1.body.id));
    await call(status, 'POST', `admin/reels/${brandOnly.body.id}/status`, manager, { status: 'active' }, { id: brandOnly.body.id });
    await call(status, 'POST', `admin/reels/${made1.body.id}/status`, manager, { status: 'active' }, { id: made1.body.id });
    customers = await feed();
    const brandReel = customers.find(r => r.id === brandOnly.body.id);
    check('show: both are back; the brand reel has a brand and no product', customers.some(r => r.id === made1.body.id) && !!brandReel && !brandReel.product && brandReel.brand?.id === 'nivea', brandReel);

    const ids = ((await call(list, 'GET', 'admin/reels?city=latur', manager)).body as any[]).map(r => r.id);
    const reversed = [...ids].reverse();
    const ordered = await call(order, 'POST', 'admin/reels/order', manager, { city_id: 'latur', ids: reversed });
    check('order: the whole city in a new order', ordered.status === 200 && JSON.stringify((await feed()).map(r => r.id)) === JSON.stringify(reversed.filter(id => customers.some(r => r.id === id))), ordered.body);
    check('order: a list that misses a reel is refused as stale', (await call(order, 'POST', 'admin/reels/order', manager, { city_id: 'latur', ids: reversed.slice(1) })).body.code === 'stale_order');
    await call(order, 'POST', 'admin/reels/order', manager, { city_id: 'latur', ids });

    const later = await call(one, 'PUT', `admin/reels/${made1.body.id}`, manager, { ...draft, starts_at: new Date(Date.now() + 86_400_000).toISOString() }, { id: made1.body.id });
    check('window: a reel that starts tomorrow is scheduled and hidden', later.body.shown === 'scheduled' && !(await feed()).some(r => r.id === made1.body.id), later.body);

    const gone = await call(one, 'DELETE', `admin/reels/${brandOnly.body.id}`, manager, undefined, { id: brandOnly.body.id });
    check('delete: hidden from customers and from the list, the row is kept', gone.status === 200 && !(await feed()).some(r => r.id === brandOnly.body.id)
      && !((await call(list, 'GET', 'admin/reels', manager)).body as any[]).some(r => r.id === brandOnly.body.id)
      && !!(await db().from('ol_reels').select('deleted_at').eq('id', brandOnly.body.id).single()).data?.deleted_at);
    check('delete: a deleted reel is not found any more', (await call(one, 'GET', `admin/reels/${brandOnly.body.id}`, manager, undefined, { id: brandOnly.body.id })).status === 404);
  } finally {
    if (made.reels.length) await db().from('ol_reels').delete().in('id', made.reels);
    if (made.users.length) await db().from('platform_admins').delete().in('user_id', made.users);
    if (made.roles.length) await db().from('platform_roles').delete().in('id', made.roles);
    for (const id of made.users) await db().auth.admin.deleteUser(id);
  }
  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
}
main().catch(e => { console.error(e); process.exit(1); });
