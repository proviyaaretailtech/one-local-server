// Checks the One Local admin API for the Master (docs/MASTER_CONTRACT_V1.md) and the catalogue it
// feeds, with no database (memory mode). Calls the route modules exactly as Expo Router does, so the
// sign-in check, CORS, error shape and the customer-facing /api routes are all exercised:
// roles, the listing life cycle (pending -> preview -> live refused with no items -> item added in
// the Item Master -> live -> in the app), the one_local switch, pausing, media, shoppers, demand.
// Run from frontend/:  npx tsx scripts/admin-checks.ts
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY']) delete process.env[k];
process.env.MASTER_APP_URL = 'https://master.example.com, https://console.example.com';
process.env.ADMIN_DEV_TOKENS = '1'; // development tokens are off unless asked for (SRV-9 P3-4); the checks below ask

let passed = 0;
function check(what: string, ok: boolean, detail?: unknown) {
  if (!ok) { console.error(`FAIL  ${what}`, detail === undefined ? '' : JSON.stringify(detail)); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
}

type Route = (request: Request, params: Record<string, string>) => Response | Promise<Response>;
type Mod = Record<string, Route>;
type Call = { token?: string; body?: unknown; origin?: string; params?: Record<string, string>; headers?: Record<string, string>; raw?: BodyInit };
type Reply = { status: number; body: any; headers: Headers };

const MASTER = 'dev-admin:master_admin', OPS = 'dev-admin:operations', SALES = 'dev-admin:sales_executive', USER = 'dev-user';
const ALLOWED = 'https://master.example.com', EVIL = 'https://evil.example.com';

async function call(mod: Mod, method: string, path: string, c: Call = {}): Promise<Reply> {
  const headers: Record<string, string> = { ...(c.headers ?? {}) };
  if (c.token) headers.authorization = `Bearer ${c.token}`;
  if (c.origin) headers.origin = c.origin;
  if (c.body !== undefined) headers['content-type'] = 'application/json';
  const request = new Request(`http://localhost:8081/api/${path}`, { method, headers, body: c.raw ?? (c.body === undefined ? undefined : JSON.stringify(c.body)) });
  const handler = mod[method];
  if (!handler) throw new Error(`${path} has no ${method}`);
  const response = await handler(request, c.params ?? {});
  const text = await response.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch {}
  return { status: response.status, body, headers: response.headers };
}

async function main() {
  const market = await import('../server/marketplace');
  const { quote } = await import('../server/pricing');
  const load = (p: string) => import(p) as Promise<Mod>;
  const [me, orgs, listings, listing, status, preview, upload, devFile, shoppers, block, demand, catalog, stores, store, storeProducts, product, launch] = await Promise.all([
    load('../app/api/admin/me+api'), load('../app/api/admin/organizations+api'), load('../app/api/admin/listings/index+api'),
    load('../app/api/admin/listings/[id]/index+api'), load('../app/api/admin/listings/[id]/status+api'), load('../app/api/admin/listings/[id]/preview+api'),
    load('../app/api/admin/media/upload-url+api'), load('../app/api/admin/media/dev/[key]+api'), load('../app/api/admin/shoppers/index+api'),
    load('../app/api/admin/shoppers/[id]/block+api'), load('../app/api/admin/demand+api'),
    load('../app/api/catalog+api'), load('../app/api/stores/index+api'), load('../app/api/stores/[id]/index+api'), load('../app/api/stores/[id]/products+api'),
    load('../app/api/products/[id]+api'), load('../app/api/launch-requests+api'),
  ]);
  const m = market.memory();
  const appCatalog = async () => (await call(catalog, 'GET', 'catalog?city=latur')).body;
  const appStores = async () => (await call(stores, 'GET', 'stores?city=latur')).body as { id: string; name: string }[];

  // ---------- Who may call ----------
  check('no token: 401', (await call(me, 'GET', 'admin/me')).status === 401);
  check('an unknown token without a database: 401', (await call(me, 'GET', 'admin/me', { token: 'not-a-dev-token' })).status === 401);
  const notAdmin = await call(me, 'GET', 'admin/me', { token: USER });
  check('signed in but not a platform admin: 403 with { detail, code }', notAdmin.status === 403 && typeof notAdmin.body.detail === 'string' && notAdmin.body.code === 'not_platform_admin', notAdmin);
  const master = await call(me, 'GET', 'admin/me', { token: MASTER });
  check('master_admin: me says role and can_write', master.status === 200 && master.body.role === 'master_admin' && master.body.can_write === true && !!master.body.user_id, master.body);
  const sales = await call(me, 'GET', 'admin/me', { token: SALES });
  check('sales_executive: reads, cannot write', sales.status === 200 && sales.body.can_write === false, sales.body);
  check('read-only role can list listings', (await call(listings, 'GET', 'admin/listings', { token: SALES })).status === 200);
  const readOnlyWrite = await call(listings, 'POST', 'admin/listings', { token: SALES, body: {} });
  check('read-only role cannot create a listing: 403 read_only_role', readOnlyWrite.status === 403 && readOnlyWrite.body.code === 'read_only_role', readOnlyWrite);

  // ---------- SRV-5 / SRV-9 P3-4: who counts as a platform admin ----------
  delete process.env.ADMIN_DEV_TOKENS;
  const noFlag = await call(me, 'GET', 'admin/me', { token: MASTER });
  check('development tokens are refused unless ADMIN_DEV_TOKENS=1 (503, not a sign-in)', noFlag.status === 503 && noFlag.body.code === 'database_not_connected', noFlag);
  process.env.ADMIN_DEV_TOKENS = '1';
  const nodeEnv = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: 'production' });
  const inProd = await call(me, 'GET', 'admin/me', { token: MASTER });
  check('development tokens never work in production, flag or not', inProd.status === 503 && inProd.body.code === 'database_not_connected', inProd);
  if (nodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else process.env.NODE_ENV = nodeEnv;
  const admin = await import('../server/admin');
  const adminRow = (over: Record<string, unknown> = {}, role: unknown = { key: 'super_admin', is_active: true }) => ({ user_id: 'u1', status: 'Active', first_name: 'A', last_name: 'B', platform_roles: role, ...over }) as any;
  const liveAdmin = admin.adminFromRow(adminRow(), 'a@example.com');
  check('live: an Active admin on the active super_admin role is an admin who can write', liveAdmin?.role === 'super_admin' && liveAdmin.canWrite === true && liveAdmin.fullName === 'A B', liveAdmin);
  check('live: an array-shaped role embed is read the same way', admin.adminFromRow(adminRow({}, [{ key: 'super_admin', is_active: true }]), null)?.role === 'super_admin');
  check('live: a limited role is not a One Local admin, whatever it is called', admin.adminFromRow(adminRow({}, { key: 'support_ro', is_active: true }), null) === null && admin.adminFromRow(adminRow({}, { key: 'operations', is_active: true }), null) === null && admin.adminFromRow(adminRow({}, { key: 'master_admin', is_active: true }), null) === null);
  check('live: a deactivated super_admin role is refused', admin.adminFromRow(adminRow({}, { key: 'super_admin', is_active: false }), null) === null && admin.adminFromRow(adminRow({}, { key: 'super_admin' }), null) === null);
  check('live: Suspended, Inactive and Pending admins are refused', ['Suspended', 'Inactive', 'Pending'].every(status => admin.adminFromRow(adminRow({ status }), null) === null));
  check('live: no role, or a row of an unexpected shape, is refused (fails closed)', admin.adminFromRow(adminRow({}, null), null) === null && admin.adminFromRow({ user_id: 'u1' } as any, null) === null && admin.adminFromRow(adminRow({ status: undefined }), null) === null);

  // ---------- CORS ----------
  const pre = await call(listings, 'OPTIONS', 'admin/listings', { origin: ALLOWED, headers: { 'access-control-request-method': 'POST' } });
  check('preflight from the Master: 204 with allow-origin, methods and headers', pre.status === 204 && pre.headers.get('access-control-allow-origin') === ALLOWED
    && /PATCH/.test(pre.headers.get('access-control-allow-methods') ?? '') && /authorization/.test(pre.headers.get('access-control-allow-headers') ?? ''), Object.fromEntries(pre.headers));
  check('preflight from another website: 403', (await call(listings, 'OPTIONS', 'admin/listings', { origin: EVIL })).status === 403);
  check('second MASTER_APP_URL origin allowed too', (await call(me, 'GET', 'admin/me', { token: MASTER, origin: 'https://console.example.com' })).headers.get('access-control-allow-origin') === 'https://console.example.com');
  const corsError = await call(me, 'GET', 'admin/me', { origin: ALLOWED });
  check('errors carry CORS headers too (401 readable by the Master)', corsError.status === 401 && corsError.headers.get('access-control-allow-origin') === ALLOWED);
  check('a call from another website is refused: 403', (await call(me, 'GET', 'admin/me', { token: MASTER, origin: EVIL })).status === 403);

  // ---------- Organizations ----------
  const all = (await call(orgs, 'GET', 'admin/organizations', { token: SALES })).body as any[];
  const dining = all.find(o => o.id === market.SAMPLE.dining), mart = all.find(o => o.id === market.SAMPLE.mart);
  check('organizations: outlets, Item Master size, items live, no listing yet', all.length === 2 && dining.items === 5 && dining.categories === 3 && dining.items_live === 4
    && dining.locations.length === 1 && mart.items === 0 && mart.listing === null, all);
  const search = (await call(orgs, 'GET', 'admin/organizations?q=fresh', { token: SALES })).body as any[];
  check('organizations ?q= searches by name', search.length === 1 && search[0].id === market.SAMPLE.mart, search);

  // ---------- A listing for an organization with no items ----------
  const martListing = {
    organization_id: market.SAMPLE.mart, location_id: market.SAMPLE.martOutlet, name: 'Latur Fresh Mart', department: 'grocery', city_id: 'latur',
    tagline: 'Farm to home', address: 'Shop 4, Ausa Road, Latur 413512', lat: 18.3950, lng: 76.5750, delivery_radius_km: 5, delivery_time: '20 min',
  };
  const invalid = async (what: string, body: object, expect = 400) => {
    const r = await call(listings, 'POST', 'admin/listings', { token: MASTER, body });
    check(`create refused: ${what} (${expect})`, r.status === expect && typeof r.body.detail === 'string', r);
  };
  await invalid('unknown department', { ...martListing, department: 'toys' });
  await invalid('latitude and longitude swapped', { ...martListing, lat: 76.575, lng: 18.395 });
  await invalid('an outlet of another organization', { ...martListing, location_id: market.SAMPLE.diningOutlet });
  await invalid('a city One Local does not serve', { ...martListing, city_id: 'pune' });
  await invalid('missing address', { ...martListing, address: undefined });
  await invalid('a status in the body', { ...martListing, status: 'live' });
  await invalid('an organization that does not exist', { ...martListing, organization_id: '00000000-0000-4000-8000-000000000999', location_id: undefined }, 404);

  const created = await call(listings, 'POST', 'admin/listings', { token: MASTER, body: martListing, origin: ALLOWED });
  const martId = created.body.id as string;
  check('create: 201, pending, id from the organization and outlet', created.status === 201 && created.body.status === 'pending' && martId === 'org-latur-fresh-mart-ausa', created.body);
  check('create: Listing shape (organization name, address, map point, radius, items_live 0)', created.body.organization_name === 'Latur Fresh Mart' && created.body.address === martListing.address
    && created.body.lat === 18.395 && created.body.delivery_radius_km === 5 && created.body.items_live === 0 && created.body.approved_at === null, created.body);
  check('create: Listing names its outlet (location_name) and sends numbers as numbers', created.body.location_name === 'Ausa Road' && typeof created.body.lng === 'number' && typeof created.body.delivery_radius_km === 'number', created.body);
  const row = m.stores.find(s => s.id === martId);
  const channel = m.channels.find(c => c.organization_id === market.SAMPLE.mart);
  check('create: saved with is_demo = false; ol_merchant_channels row upserted, not accepting', row?.is_demo === false && channel?.store_id === martId && channel.accepting === false && channel.address === martListing.address, { row, channel });
  check('create: a second listing for the same outlet is refused (409)', (await call(listings, 'POST', 'admin/listings', { token: MASTER, body: martListing })).status === 409);

  const pending = (await call(listings, 'GET', 'admin/listings?status=pending&city=latur', { token: SALES })).body as any[];
  check('list ?status=pending&city=latur finds it', pending.length === 1 && pending[0].id === martId);
  check('a pending listing is not in the app', !(await appStores()).some(s => s.id === martId));
  const emptyPreview = await call(preview, 'GET', `admin/listings/${martId}/preview`, { token: SALES, params: { id: martId } });
  check('preview of a pending listing: { store: Listing, categories: [], items_live: 0 }', emptyPreview.status === 200 && emptyPreview.body.store.id === martId && emptyPreview.body.store.status === 'pending'
    && emptyPreview.body.categories.length === 0 && emptyPreview.body.items_live === 0, emptyPreview.body);
  const refused = await call(status, 'POST', `admin/listings/${martId}/status`, { token: MASTER, body: { status: 'live' }, params: { id: martId } });
  check('going live with no items is refused (409 no_available_items)', refused.status === 409 && refused.body.code === 'no_available_items' && /no items/.test(refused.body.detail), refused.body);

  // ---------- The merchant adds an item in the Item Master; the listing goes live ----------
  const fruitCategory = '10000000-0000-4000-8000-000000000001', tomato = '20000000-0000-4000-8000-000000000001';
  m.categories.push({ id: fruitCategory, organization_id: market.SAMPLE.mart, name: 'Fruits & Vegetables', sort_order: 0 });
  m.items.push({ id: tomato, organization_id: market.SAMPLE.mart, category_id: fruitCategory, name: 'Fresh Tomatoes', price: '40.00', image_url: 'https://example.com/tomato.jpg', is_available: true, sort_order: 0 });
  const productId = `${martId}_${tomato}`;
  const fullPreview = (await call(preview, 'GET', `admin/listings/${martId}/preview`, { token: SALES, params: { id: martId } })).body;
  const previewItem = fullPreview.categories[0]?.items[0];
  check('preview shows the new item in its menu category, priced from the POS, available on One Local', fullPreview.categories.length === 1 && fullPreview.categories[0].id === fruitCategory
    && fullPreview.categories[0].name === 'Fruits & Vegetables' && previewItem?.id === tomato && previewItem.price === 40 && previewItem.image === 'https://example.com/tomato.jpg'
    && previewItem.available_on_one_local === true && fullPreview.items_live === 1, fullPreview);
  const live = await call(status, 'POST', `admin/listings/${martId}/status`, { token: MASTER, body: { status: 'live', reason: 'Checked the shop' }, params: { id: martId } });
  check('going live with an item: live, approval recorded', live.status === 200 && live.body.status === 'live' && !!live.body.approved_at && live.body.items_live === 1
    && m.stores.find(s => s.id === martId)?.approved_by === market.devAdminId('master_admin'), live.body);

  // ---------- The app shows it with no app change ----------
  let app = await appCatalog();
  const inApp = app.products.find((p: any) => p.id === productId);
  check('/api/catalog: the item is a product of the listing (store, department, brand, price)', !!inApp && inApp.store_id === martId && inApp.department === 'grocery'
    && inApp.brand_id === martId && inApp.price === 40 && inApp.mrp === 40 && inApp.category_id === 'im-grocery-fruits-and-vegetables', inApp);
  check('/api/catalog: the organization is a brand; its menu category is a grocery category', app.brands.some((b: any) => b.id === martId && b.name === 'Latur Fresh Mart')
    && app.categories.some((c: any) => c.id === 'im-grocery-fruits-and-vegetables' && c.department === 'grocery'));
  check('/api/catalog: the demo catalogue is still there too', app.products.some((p: any) => p.id === 'p1') && app.products[0].id === productId);
  check('/api/stores lists the live store', (await appStores()).some(s => s.id === martId));
  const storePage = await call(store, 'GET', `stores/${martId}?city=latur`, { params: { id: martId } });
  check('/api/stores/:id opens it, cover-less, with its tagline', storePage.status === 200 && storePage.body.tagline === 'Farm to home', storePage.body);
  const storeItems = (await call(storeProducts, 'GET', `stores/${martId}/products?city=latur`, { params: { id: martId } })).body as any[];
  check('/api/stores/:id/products has the item', storeItems.length === 1 && storeItems[0].id === productId);
  check('/api/products/:id finds it', (await call(product, 'GET', `products/${productId}?city=latur`, { params: { id: productId } })).status === 200);
  const bill = await quote('latur', [{ id: productId, qty: 5 }], null);
  check('the cart bills it as its own store (₹200, free delivery)', bill.groups.length === 1 && bill.groups[0].store_id === martId && bill.groups[0].store_name === 'Latur Fresh Mart' && bill.total === 200, bill.total);

  // ---------- The one_local switch (item_channel_status) ----------
  const off = { menu_item_id: tomato, organization_id: market.SAMPLE.mart, is_available: false, off_until: null as string | null };
  m.switches.push(off);
  app = await appCatalog();
  check('item switched off for one_local disappears from the app', !app.products.some((p: any) => p.id === productId));
  check('GET /listings/:id: one Listing, now with 0 items live', (await call(listing, 'GET', `admin/listings/${martId}`, { token: SALES, params: { id: martId } })).body.items_live === 0);
  const offPreview = (await call(preview, 'GET', `admin/listings/${martId}/preview`, { token: SALES, params: { id: martId } })).body;
  check('preview marks the switched-off item as not on One Local', offPreview.categories[0].items[0].available_on_one_local === false && offPreview.items_live === 0, offPreview);
  off.off_until = new Date(Date.now() - 60_000).toISOString();
  check('switched off until a time now past counts as on again', (await appCatalog()).products.some((p: any) => p.id === productId));
  off.off_until = new Date(Date.now() + 3_600_000).toISOString();
  check('switched off until later today: still hidden', !(await appCatalog()).products.some((p: any) => p.id === productId));
  m.switches.splice(m.switches.indexOf(off), 1);
  check('switch removed: back in the app', (await appCatalog()).products.some((p: any) => p.id === productId));

  // ---------- A restaurant: variants, and items unavailable in the POS ----------
  const food = await call(listings, 'POST', 'admin/listings', { token: OPS, body: {
    organization_id: market.SAMPLE.dining, name: 'Mysore Dining Hall', department: 'food', city_id: 'latur', address: 'Station Road, Latur 413512', lat: 18.40, lng: 76.56,
  } });
  const diningId = food.body.id as string;
  check('operations can create a listing; without an outlet the id is org-<slug>', food.status === 201 && diningId === 'org-mysore-dining-hall', food.body);
  check('operations can switch it live', (await call(status, 'POST', `admin/listings/${diningId}/status`, { token: OPS, body: { status: 'live' }, params: { id: diningId } })).body.status === 'live');
  app = await appCatalog();
  const dishes = app.products.filter((p: any) => p.store_id === diningId);
  const biriyani = dishes.filter((p: any) => p.name === 'Chicken Biriyani');
  check('each variant is its own product: Half ₹185, Full ₹269', biriyani.length === 2 && biriyani[0].price === 185 && biriyani[0].weight === 'Mysore Dining Hall · Half' && biriyani[1].price === 269, biriyani);
  check('an item unavailable in the POS is not shown', !dishes.some((p: any) => p.name === 'Mutton Biriyani') && dishes.length === 5, dishes.map((p: any) => p.name));
  check('restaurant dishes are food products with food categories', dishes.every((p: any) => p.department === 'food' && p.category_id.startsWith('im-food-')));
  const foodBill = await quote('latur', biriyani.map((p: any) => ({ id: p.id, qty: 1 })), null);
  check('both variants go in one food cart from one restaurant', foodBill.kind === 'food' && foodBill.groups.length === 1 && foodBill.item_total === 454, foodBill.item_total);

  // ---------- Editing ----------
  const edit = (id: string, body: unknown, token = MASTER) => call(listing, 'PATCH', `admin/listings/${id}`, { token, body, params: { id } });
  const renamed = await edit(martId, { name: 'Latur Fresh Mart & Dairy', address: 'Shop 5, Ausa Road, Latur 413512', delivery_time: '15 min' });
  check('PATCH renames the listing and moves its pickup address', renamed.status === 200 && renamed.body.name === 'Latur Fresh Mart & Dairy' && renamed.body.address === 'Shop 5, Ausa Road, Latur 413512'
    && m.channels.find(c => c.organization_id === market.SAMPLE.mart)?.address === 'Shop 5, Ausa Road, Latur 413512', renamed.body);
  check('the app shows the new name at once', (await appStores()).find(s => s.id === martId)?.name === 'Latur Fresh Mart & Dairy');
  check('PATCH refuses a status (use /status)', (await edit(martId, { status: 'paused' })).status === 400);
  check('PATCH refuses unknown fields', (await edit(martId, { colour: 'green' })).status === 400);
  check('PATCH refuses moving to another organization', (await edit(martId, { organization_id: market.SAMPLE.dining })).status === 400);
  check('PATCH by a read-only role: 403', (await edit(martId, { name: 'Nope' }, SALES)).status === 403);
  check('PATCH an unknown listing: 404', (await edit('org-nobody', { name: 'Nope' })).status === 404);

  // ---------- Pausing ----------
  const noReason = await call(status, 'POST', `admin/listings/${martId}/status`, { token: OPS, body: { status: 'paused' }, params: { id: martId } });
  check('pausing needs a reason (400 reason_required)', noReason.status === 400 && noReason.body.code === 'reason_required', noReason.body);
  const paused = await call(status, 'POST', `admin/listings/${martId}/status`, { token: OPS, body: { status: 'paused', reason: 'Owner on leave' }, params: { id: martId } });
  app = await appCatalog();
  check('paused listing: gone from /api/stores and its items from /api/catalog', paused.body.status === 'paused' && !(await appStores()).some(s => s.id === martId)
    && !app.products.some((p: any) => p.store_id === martId) && !app.brands.some((b: any) => b.id === martId));
  check('a paused listing\'s product can no longer be put in a cart', await quote('latur', [{ id: productId, qty: 1 }], null).then(() => false, () => true));
  check('read-only role cannot change status: 403', (await call(status, 'POST', `admin/listings/${martId}/status`, { token: SALES, body: { status: 'live' }, params: { id: martId } })).status === 403);
  check('a status other than live/paused/pending: 400', (await call(status, 'POST', `admin/listings/${martId}/status`, { token: MASTER, body: { status: 'draft' }, params: { id: martId } })).status === 400);
  check('live again after the pause', (await call(status, 'POST', `admin/listings/${martId}/status`, { token: MASTER, body: { status: 'live' }, params: { id: martId } })).body.status === 'live'
    && (await appStores()).some(s => s.id === martId));
  const allListings = (await call(listings, 'GET', 'admin/listings', { token: SALES })).body as any[];
  check('list: both listings, newest first', allListings.length === 2 && allListings[0].id === diningId, allListings.map(l => l.id));
  const secondPage = await call(listings, 'GET', 'admin/listings?page=2', { token: SALES });
  check('list ?page=2 is empty with X-Total-Count 2; a bad page is 400', secondPage.body.length === 0 && secondPage.headers.get('x-total-count') === '2'
    && (await call(listings, 'GET', 'admin/listings?page=0', { token: SALES })).status === 400);
  check('GET an unknown listing: 404 not_found', (await call(listing, 'GET', 'admin/listings/org-nobody', { token: SALES, params: { id: 'org-nobody' } })).body.code === 'not_found');
  check('organizations now show their listing', ((await call(orgs, 'GET', 'admin/organizations', { token: SALES })).body as any[]).every(o => o.listing?.status === 'live'));

  // ---------- Media ----------
  const ask = (body: unknown, token = MASTER) => call(upload, 'POST', 'admin/media/upload-url', { token, body });
  check('upload link refused for a GIF', (await ask({ folder: 'stores', filename: 'logo.gif', content_type: 'image/gif' })).status === 400);
  check('upload link refused when the name does not match the type', (await ask({ folder: 'stores', filename: 'logo.png', content_type: 'image/jpeg' })).status === 400);
  check('upload link refused for another folder', (await ask({ folder: 'products', filename: 'logo.jpg', content_type: 'image/jpeg' })).status === 400);
  check('upload link refused over 5 MB', (await ask({ folder: 'stores', filename: 'logo.jpg', content_type: 'image/jpeg', size: 6 * 1024 * 1024 })).status === 413);
  check('upload link refused for a read-only role', (await ask({ folder: 'stores', filename: 'logo.jpg', content_type: 'image/jpeg' }, SALES)).status === 403);
  const link = await ask({ folder: 'stores', filename: 'Fresh Mart Logo.JPG', content_type: 'image/jpeg', size: 1000 });
  check('upload link: signed upload URL and public URL', link.status === 200 && /\/api\/admin\/media\/dev\/[0-9a-f]{16}-fresh-mart-logo\.jpg$/.test(link.body.upload_url) && link.body.public_url === link.body.upload_url
    && /^stores\/\d{4}\/\d{2}\//.test(link.body.path), link.body);
  const key = String(link.body.upload_url).split('/').pop()!;
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  check('upload with the wrong content type: 400', (await call(devFile, 'PUT', `admin/media/dev/${key}`, { params: { key }, raw: jpeg, headers: { 'content-type': 'image/png' } })).status === 400);
  check('upload the file (memory stand-in for Supabase Storage)', (await call(devFile, 'PUT', `admin/media/dev/${key}`, { params: { key }, raw: jpeg, headers: { 'content-type': 'image/jpeg' }, origin: ALLOWED })).status === 200);
  const served = await call(devFile, 'GET', `admin/media/dev/${key}`, { params: { key } });
  check('the uploaded image is served back', served.status === 200 && served.headers.get('content-type') === 'image/jpeg');
  check('a used upload link cannot be reused', (await call(devFile, 'PUT', `admin/media/dev/${key}`, { params: { key }, raw: jpeg, headers: { 'content-type': 'image/jpeg' } })).status === 409);
  const withLogo = await edit(martId, { logo: link.body.public_url, cover_image: link.body.public_url });
  check('the public URL can be saved as logo and cover', withLogo.status === 200 && withLogo.body.logo === link.body.public_url);
  const cover = (await call(store, 'GET', `stores/${martId}?city=latur`, { params: { id: martId } })).body;
  check('the cover image is first in the store page gallery', cover.media[0]?.url === link.body.public_url && cover.logo === link.body.public_url, cover.media);
  check('a non-https image link is refused', (await edit(martId, { logo: 'ftp://example.com/logo.jpg' })).status === 400);

  // ---------- Shoppers ----------
  const asha = m.users[0], ravi = m.users[1];
  const orders = ((globalThis as any).__onecityStore ??= { checkouts: [], orders: [], replies: new Map(), enquiries: [], support: [] }).orders as object[];
  orders.push({ id: 'o1', user_id: asha.id, checkout_id: 'k1' }, { id: 'o2', user_id: asha.id, checkout_id: 'k1' }, { id: 'o3', user_id: asha.id, checkout_id: null });
  const people = (await call(shoppers, 'GET', 'admin/shoppers', { token: SALES })).body as any[];
  const ashaRow = people.find(p => p.id === asha.id);
  check('shoppers: every account, newest first, with order counts (a split checkout counts once)', people.length === m.users.length && people[0].id === m.users[2].id
    && ashaRow.orders === 2 && ashaRow.blocked === false && ashaRow.email === asha.email, ashaRow);
  const byEmail = (await call(shoppers, 'GET', 'admin/shoppers?q=ASHA', { token: SALES })).body as any[];
  const byPhone = (await call(shoppers, 'GET', `admin/shoppers?q=${encodeURIComponent('+91 98000 00002')}`, { token: SALES })).body as any[];
  check('shoppers ?q= finds by email and by phone', byEmail.length === 1 && byEmail[0].id === asha.id && byPhone.length === 1 && byPhone[0].id === ravi.id, { byEmail, byPhone });
  const blockCall = (id: string, body: unknown, token = MASTER) => call(block, 'POST', `admin/shoppers/${id}/block`, { token, body, params: { id } });
  check('blocking needs a reason', (await blockCall(asha.id, { blocked: true })).status === 400);
  check('a read-only role cannot block: 403', (await blockCall(asha.id, { blocked: true, reason: 'Abusive to riders' }, SALES)).status === 403);
  const blocked = await blockCall(asha.id, { blocked: true, reason: 'Abusive to riders' });
  check('block: { id, blocked: true }, a ban (not a delete)', blocked.status === 200 && blocked.body.blocked === true && blocked.body.id === asha.id && m.users.includes(asha) && !!asha.banned_until, blocked.body);
  check('the list shows the shopper blocked', ((await call(shoppers, 'GET', 'admin/shoppers?q=asha', { token: SALES })).body as any[])[0].blocked === true);
  const unblocked = await blockCall(asha.id, { blocked: false, reason: 'Apologised' });
  check('unblock: blocked false again', unblocked.body.blocked === false && asha.banned_until === null);
  const adminBlock = await blockCall(market.devAdminId('master_admin'), { blocked: true, reason: 'Testing' });
  check('blocking a platform admin is refused (409 cannot_block_admin)', adminBlock.status === 409 && adminBlock.body.code === 'cannot_block_admin', adminBlock.body);
  check('blocking an unknown account: 404', (await blockCall('00000000-0000-4000-8000-000000000999', { blocked: true, reason: 'Testing' })).status === 404);
  check('blocking with a malformed id: 404', (await blockCall('not-a-uuid', { blocked: true, reason: 'Testing' })).status === 404);

  for (let i = 0; i < 60; i++) {
    m.users.push({ id: `30000000-0000-4000-8000-${String(i).padStart(12, '0')}`, email: `older${i}@example.com`, phone: null, created_at: new Date(Date.now() - (100 + i) * 86_400_000).toISOString(), last_sign_in_at: null, banned_until: null });
  }
  const first = await call(shoppers, 'GET', 'admin/shoppers', { token: SALES });
  const second = (await call(shoppers, 'GET', 'admin/shoppers?page=2', { token: SALES })).body as any[];
  check('shoppers without q: the 50 most recent, ?page=2 the rest, X-Total-Count', first.body.length === 50 && first.body[0].id === m.users[2].id
    && first.headers.get('x-total-count') === String(m.users.length) && second.length === m.users.length - 50 && !second.some(p => first.body.some((f: any) => f.id === p.id)));
  check('shopper order counts are JSON numbers', first.body.every((p: any) => typeof p.orders === 'number'));

  // ---------- Demand ----------
  const { searchIndia } = await import('../server/geo');
  const killari = searchIndia('Killari', null, 1)[0];
  const ask4 = (who: string) => call(launch, 'POST', 'launch-requests', { body: { place_id: killari.id }, headers: { 'x-customer-key': who.padEnd(32, '0') } });
  for (const who of ['demand-a', 'demand-b']) await ask4(who);
  const wanted = (await call(demand, 'GET', 'admin/demand', { token: SALES })).body as any[];
  check('demand: launch requests counted per place', wanted.length === 1 && wanted[0].requests === 2 && wanted[0].place.startsWith('Killari') && !!wanted[0].last_at, wanted);
  check('demand needs a platform admin', (await call(demand, 'GET', 'admin/demand', { token: USER })).status === 403);

  console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
