// Reels for the customer app's Discover and Reels tabs, run from Master Admin (specs/reels-admin/spec.md). Super admins, and staff whose
// Master Admin role includes the reels feature (requireFeature: seeing needs view_reels, changing needs full access and manage_reels).
// Customers read them through GET /api/reels (server/catalog.ts reelsFor); this file is the admin side: list, read, create, edit, pause or
// show again, put in order, delete (soft: the row is kept with deleted_at), and the pickers the editor needs (cities, products, brands).
// The database (migration 0642) checks status, window, media addresses, text lengths and that the product or brand exists; the checks
// here turn mistakes into sentences first, and also require the product or brand to be in the reel's city in the live catalogue.
import { z } from 'zod';
import { AdminError, audit, REELS_FEATURE, requireFeature } from './admin';
import { cities } from './admin-popups';
import { getCatalog, inCity, invalidateCatalog } from './catalog';
import { db, dbConfigured } from './db';
import { supabaseUrl } from './env';
import { limit, readBody } from './http';

const bad = (detail: string, code = 'invalid_request') => new AdminError(400, code, detail);
const notFound = () => new AdminError(404, 'not_found', 'Reel not found');
const needDb = () => { if (!dbConfigured()) throw new AdminError(503, 'unavailable', 'Reels need the database.'); };
const view = (request: Request) => requireFeature(request, REELS_FEATURE, false);
const manage = async (request: Request) => {
  const admin = await requireFeature(request, REELS_FEATURE, true);
  limit(admin.userId, 'admin-reel-write', 60, 60_000);
  return admin;
};

// A reel's video and pictures: a file uploaded to our own media bucket, or a catalogue media path (/api/media/<key>). Outside production a
// local address is accepted too (the memory-mode stand-in for Storage). Anything else (another website's file) is refused.
const BUCKET_PATH = '/storage/v1/object/public/onecity-catalog/';
function mediaOk(value: string) {
  if (/^\/api\/media\/[A-Za-z0-9._-]{1,160}$/.test(value)) return true;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (!/^https?:$/.test(url.protocol) || /\s/.test(value)) return false;
  const own = supabaseUrl()?.replace(/\/+$/, '');
  if (own && value.startsWith(own + BUCKET_PATH)) return true;
  return process.env.NODE_ENV !== 'production' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
}

const Text = z.string().trim();
const Id = Text.min(1).max(200).regex(/^[A-Za-z0-9._-]+$/, 'pick one from the list');
const Media = Text.min(1).max(500).refine(mediaOk, 'must be a file uploaded here');
const Optional = <T extends z.ZodTypeAny>(t: T) => z.union([t, z.literal('').transform(() => null), z.null()]).optional();
const Draft = z.object({
  city_id: Text.min(1).max(40).regex(/^[a-z0-9_-]+$/, 'pick a city'),
  product_id: Optional(Id),
  brand_id: Optional(Id),
  video: Media,
  video_web: Optional(Media),
  poster: Optional(Media),
  caption: Optional(Text.max(300)),
  creator: Optional(Text.max(60)),
  tag: Optional(Text.max(40)),
  starts_at: Optional(z.iso.datetime({ offset: true })),
  ends_at: Optional(z.iso.datetime({ offset: true })),
}).strict()
  .refine(r => !!r.product_id || !!r.brand_id, { message: 'Link the reel to a product, a brand, or both', path: ['product_id'] })
  .refine(r => !r.starts_at || !r.ends_at || new Date(r.ends_at) > new Date(r.starts_at), { message: 'The end must be after the start', path: ['ends_at'] });
type ReelDraft = z.infer<typeof Draft>;

const FIELD: Record<string, string> = {
  city_id: 'City', product_id: 'Product', brand_id: 'Brand', video: 'Video', video_web: 'Web video', poster: 'Poster',
  caption: 'Caption', creator: 'Creator', tag: 'Tag', starts_at: 'Start', ends_at: 'End',
};
function parseDraft(body: unknown): ReelDraft {
  const r = Draft.safeParse(body);
  if (r.success) return r.data;
  const first = r.error.issues[0];
  // Our own rules read as sentences ("Link the reel to ..."); field checks from zod get the field's name in front.
  if (/^[A-Z]/.test(first.message)) throw bad(first.message);
  const field = String(first.path[0] ?? '');
  throw bad(`${FIELD[field] ?? (field || 'Reel')}: ${first.message}`);
}

// Database messages from 0642 become the admin's words.
function fromDb(error: { code?: string; message?: string }): never {
  const m = error.message ?? '';
  if (m.includes('OL_REEL_UNKNOWN_PRODUCT')) throw bad('That product does not exist.', 'unknown_product');
  if (m.includes('OL_REEL_UNKNOWN_BRAND')) throw bad('That brand does not exist.', 'unknown_brand');
  if (error.code === '23503') throw bad('That city does not exist.', 'unknown_city');
  if (error.code === '23514') throw bad('The reel breaks a rule: ' + (m.match(/constraint "([^"]+)"/)?.[1] ?? 'check the fields') + '.');
  console.error('[admin-reels] database error', error.code);
  throw new AdminError(500, 'server_error', 'Could not save the reel. Please try again.');
}

const COLUMNS = 'id, city_id, product_id, brand_id, video, video_web, poster, caption, creator, tag, likes, status, starts_at, ends_at, sort_order, is_demo, created_at, updated_at, created_by, updated_by';
type Row = {
  id: string; city_id: string; product_id: string | null; brand_id: string | null; video: string; video_web: string | null; poster: string | null;
  caption: string | null; creator: string | null; tag: string | null; likes: number; status: 'active' | 'paused';
  starts_at: string | null; ends_at: string | null; sort_order: number; is_demo: boolean; created_at: string; updated_at: string;
};
type Catalog = Awaited<ReturnType<typeof getCatalog>>;

// Whether customers see the reel right now, and if not, why: paused, not started, over, or its product and brand are gone.
export function reelShown(r: Pick<Row, 'status' | 'starts_at' | 'ends_at'>, linked: boolean, now = Date.now()) {
  if (r.status !== 'active') return 'paused';
  if (r.starts_at && new Date(r.starts_at).getTime() > now) return 'scheduled';
  if (r.ends_at && new Date(r.ends_at).getTime() <= now) return 'over';
  return linked ? 'shown' : 'link_missing';
}

// Catalogue media paths (/api/media/<key>) are this server's; the Master's browser needs the full address to show them.
const absolute = (origin: string, value: string | null | undefined) => (value && value.startsWith('/api/media/') ? origin + value : value || null);

function hydrate(r: Row, data: Catalog, origin: string) {
  const product = r.product_id ? inCity(data.products, r.city_id).find(p => p.id === r.product_id) : undefined;
  const brand = r.brand_id ? inCity(data.brands, r.city_id).find(b => b.id === r.brand_id) : undefined;
  const by = brand ?? (product ? data.brands.find(b => b.id === product.brand_id) : undefined);
  return {
    ...r,
    // Who the reel says it is from: the creator typed in, else the brand's name (the same rule customers see, catalog.ts reelsFor).
    display_creator: r.creator || by?.name || null,
    product: product ? { id: product.id, name: product.name, image: absolute(origin, product.image), price: product.price } : null,
    brand: brand ? { id: brand.id, name: brand.name, logo: absolute(origin, brand.logo) } : null,
    // What the Master shows as a preview: the web copy (or the video) and the still customers see first.
    preview: { video: absolute(origin, r.video_web || (r.video.startsWith('/api/media/') ? `${r.video}-webm` : r.video)), poster: absolute(origin, r.poster || product?.image || brand?.image) },
    shown: reelShown(r, !!product || (!r.product_id && !!brand)),
  };
}
const originOf = (request: Request) => new URL(request.url).origin;

// The product and brand must be in the reel's city in the catalogue customers see.
async function checkLinks(d: ReelDraft) {
  const data = await getCatalog();
  const product = d.product_id ? inCity(data.products, d.city_id).find(p => p.id === d.product_id) : undefined;
  if (d.product_id && !product) throw bad("That product is not in this city's catalogue.", 'unknown_product');
  const brand = d.brand_id ? inCity(data.brands, d.city_id).find(b => b.id === d.brand_id) : undefined;
  if (d.brand_id && !brand) throw bad("That brand is not in this city's catalogue.", 'unknown_brand');
  return { data };
}

const ReelId = z.string().regex(/^[A-Za-z0-9._-]{1,100}$/);
const idOf = (id: string) => { if (!ReelId.safeParse(id).success) throw notFound(); return id; };
async function rowOr404(id: string): Promise<Row> {
  const { data, error } = await db().from('ol_reels').select(COLUMNS).eq('id', idOf(id)).is('deleted_at', null).maybeSingle();
  if (error) fromDb(error);
  if (!data) throw notFound();
  return data as Row;
}
const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');

// ---------- Reading ----------
// Every reel not deleted, in the order customers see them (?city=, ?status=active|paused).
export async function listReels(request: Request) {
  await view(request); needDb();
  const url = new URL(request.url);
  let q = db().from('ol_reels').select(COLUMNS, { count: 'exact' }).is('deleted_at', null)
    .order('city_id').order('sort_order').order('created_at').limit(500);
  const city = url.searchParams.get('city'); const status = url.searchParams.get('status');
  if (city && /^[a-z0-9_-]{1,40}$/.test(city)) q = q.eq('city_id', city);
  if (status === 'active' || status === 'paused') q = q.eq('status', status);
  const { data, error, count } = await q;
  if (error) fromDb(error);
  const catalog = await getCatalog();
  return { rows: ((data ?? []) as Row[]).map(r => hydrate(r, catalog, originOf(request))), total: count ?? 0 };
}

export async function getReel(request: Request, id: string) {
  await view(request); needDb();
  return hydrate(await rowOr404(id), await getCatalog(), originOf(request));
}

// The editor's pickers: cities, and the products (searchable with ?q=, at most 100) and brands of one city (?city=, default latur).
export async function reelOptions(request: Request) {
  await view(request); needDb();
  const url = new URL(request.url);
  const city = (url.searchParams.get('city') ?? 'latur').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(city)) throw bad('Unknown city.');
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  if (q.length > 80) throw bad('Please use a shorter search.');
  const data = await getCatalog();
  const brands = inCity(data.brands, city);
  const names = new Map(brands.map(b => [b.id, b.name]));
  const products = inCity(data.products, city)
    .filter(p => !q || `${p.name} ${names.get(p.brand_id) ?? ''}`.toLowerCase().includes(q))
    .slice(0, 100)
    .map(p => ({ id: p.id, name: p.name, image: absolute(originOf(request), p.image), price: p.price, brand_id: p.brand_id || null, brand: names.get(p.brand_id) ?? null, department: p.department }));
  return {
    cities: await cities(),
    products,
    brands: brands.map(b => ({ id: b.id, name: b.name, logo: absolute(originOf(request), b.logo), department: b.department })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ---------- Writing ----------
export async function createReel(request: Request) {
  const admin = await manage(request); needDb();
  // status (optional, default active): whether customers see the new reel straight away.
  const { status, ...body } = await readBody(request, 16 * 1024);
  if (status !== undefined && status !== 'active' && status !== 'paused') throw bad('status must be active or paused.');
  const show = status !== 'paused';
  const d = parseDraft(body);
  const { data: catalog } = await checkLinks(d);
  const { data: last, error: lastError } = await db().from('ol_reels').select('sort_order').eq('city_id', d.city_id).is('deleted_at', null)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle();
  if (lastError) fromDb(lastError);
  const { data, error } = await db().from('ol_reels').insert({
    // An empty creator stays empty: customers then see the brand's name, which follows the brand if it is changed later.
    id: `reel-${randomHex(6)}`, ...d, creator: d.creator || null, likes: 0, is_demo: false,
    status: show ? 'active' : 'paused', sort_order: (last?.sort_order ?? 0) + 10, created_by: admin.userId, updated_by: admin.userId,
  }).select(COLUMNS).single();
  if (error) fromDb(error);
  audit(admin, 'reel.created', data.id, { city: d.city_id, status: data.status });
  invalidateCatalog();
  return hydrate(data as Row, catalog, originOf(request));
}

// PUT replaces what the editor shows (status, order and likes are changed elsewhere).
export async function updateReel(request: Request, id: string) {
  const admin = await manage(request); needDb();
  await rowOr404(id);
  const d = parseDraft(await readBody(request, 16 * 1024));
  const { data: catalog } = await checkLinks(d);
  const { data, error } = await db().from('ol_reels').update({ ...d, updated_by: admin.userId }).eq('id', id).is('deleted_at', null).select(COLUMNS).maybeSingle();
  if (error) fromDb(error);
  if (!data) throw notFound();
  audit(admin, 'reel.edited', id);
  invalidateCatalog();
  return hydrate(data as Row, catalog, originOf(request));
}

// { status: active | paused }: show the reel to customers again, or hide it and keep it.
export async function setReelStatus(request: Request, id: string) {
  const admin = await manage(request); needDb();
  const body = await readBody(request, 1024);
  if (body.status !== 'active' && body.status !== 'paused') throw bad('status must be active or paused.');
  const before = await rowOr404(id);
  const { data, error } = await db().from('ol_reels').update({ status: body.status, updated_by: admin.userId }).eq('id', id).is('deleted_at', null).select(COLUMNS).maybeSingle();
  if (error) fromDb(error);
  if (!data) throw notFound();
  audit(admin, body.status === 'active' ? 'reel.shown' : 'reel.paused', id, { from: before.status });
  invalidateCatalog();
  return hydrate(data as Row, await getCatalog(), originOf(request));
}

// { city_id, ids }: every reel of the city, in the order customers should see them (first = top).
export async function reorderReels(request: Request) {
  const admin = await manage(request); needDb();
  const body = await readBody(request, 32 * 1024);
  const city = typeof body.city_id === 'string' ? body.city_id.trim().toLowerCase() : '';
  if (!/^[a-z0-9_-]{1,40}$/.test(city)) throw bad('Say which city the order is for.');
  const ids = Array.isArray(body.ids) ? body.ids : null;
  if (!ids || ids.length > 500 || !ids.every(i => typeof i === 'string') || new Set(ids).size !== ids.length) throw bad('ids must list each reel once.');
  const { data, error } = await db().from('ol_reels').select('id, sort_order').eq('city_id', city).is('deleted_at', null);
  if (error) fromDb(error);
  const current = new Map((data ?? []).map(r => [r.id as string, r.sort_order as number]));
  if (ids.length !== current.size || !ids.every(i => current.has(i))) throw new AdminError(409, 'stale_order', 'The reels changed while you were ordering them. Reload and try again.');
  const moves = (ids as string[]).map((id, i) => ({ id, sort_order: (i + 1) * 10 })).filter(m => current.get(m.id) !== m.sort_order);
  for (const m of moves) {
    const { error: e } = await db().from('ol_reels').update({ sort_order: m.sort_order, updated_by: admin.userId }).eq('id', m.id);
    if (e) fromDb(e);
  }
  audit(admin, 'reel.reordered', city, { moved: moves.length });
  invalidateCatalog();
  return { city_id: city, ids, moved: moves.length };
}

// Delete: customers stop seeing it at once; the row stays (deleted_at) so its history is kept.
export async function deleteReel(request: Request, id: string) {
  const admin = await manage(request); needDb();
  await rowOr404(id);
  const { error } = await db().from('ol_reels').update({ deleted_at: new Date().toISOString(), updated_by: admin.userId }).eq('id', id).is('deleted_at', null);
  if (error) fromDb(error);
  audit(admin, 'reel.deleted', id);
  invalidateCatalog();
  return { id, deleted: true };
}
