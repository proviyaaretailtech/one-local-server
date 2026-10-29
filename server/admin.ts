// One Local admin API for the Master portal (Proviyaa OS console): /api/admin/*.
// Contract: docs/MASTER_CONTRACT_V1.md. The Master calls it with the signed-in admin's own Supabase
// access token (same Supabase project), so every change goes through One Local's own checks (D14).
//
//   * Who: a user with an Active platform_admins row whose role is the active super_admin role, the same test the database makes
//     (is_platform_super); reads and writes alike. Any other role is refused (403), and so is every call when that table cannot be
//     read (503, nothing cached). Development tokens (master_admin, onboarding_admin, operations ...) work only with no database, outside
//     production, and only with ADMIN_DEV_TOKENS=1. 401 without a valid token.
//   * CORS: the Master calls server-side, so it needs none; browsers on the Master's origin(s) from
//     MASTER_APP_URL (comma-separated, localhost too outside production) are allowed anyway, and
//     every route answers the preflight OPTIONS. Calls from any other website are refused.
//   * Errors: { detail, code } — detail for people, code for the Master's code (v1.1, see ERROR_CODES).
//   * Every write is logged as one line (who, what, when, which row) with no names, emails, phone
//     numbers or free text.
//   * No database (npx expo start, no .env): everything runs on the in-memory store in
//     marketplace.ts, and development tokens stand in for sign-in: "dev-admin:<platform role>"
//     (e.g. dev-admin:master_admin) or "dev-user" (signed in, not an admin). Never in production.
import { signedInUserId } from './auth';
import { invalidateCatalog } from './catalog';
import { db, dbConfigured, fromDbError } from './db';
import { clientIp, HttpError, limit, readBody } from './http';
import * as market from './marketplace';
import type { StoreRow } from './marketplace';

// ---------- Errors ----------
// An error the Master can act on: `code` is stable, `detail` is the sentence to show.
export class AdminError extends HttpError {
  constructor(status: number, public code: string, detail: string, headers?: Record<string, string>) { super(status, detail, headers); }
}
// Errors raised by shared helpers (readBody, limit, the database) get a code from their status.
const STATUS_CODES: Record<number, string> = {
  400: 'invalid_request', 401: 'not_signed_in', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 413: 'too_large',
  429: 'rate_limited', 500: 'server_error', 502: 'upstream_error', 503: 'unavailable',
};
const err = (status: number, code: string, detail: string) => new AdminError(status, code, detail);
const bad = (detail: string, code = 'invalid_request') => err(400, code, detail);
const notFound = (what: string) => err(404, 'not_found', `${what} not found`);

// ---------- Who is calling ----------
// 'super_admin' is the one role the live platform_roles table holds; the others are the development-token roles.
export const WRITE_ROLES = ['super_admin', 'master_admin', 'onboarding_admin', 'operations'];
export type Admin = { userId: string; email: string; fullName: string | null; role: string; canWrite: boolean };

const production = () => process.env.NODE_ENV === 'production';
const g = globalThis as unknown as { __onecityAdmins?: Map<string, { admin: Admin | null; until: number }> };
const admins = (g.__onecityAdmins ??= new Map());

const asAdmin = (row: { user_id: string; email: string | null; full_name: string | null; role: string }): Admin =>
  ({ userId: row.user_id, email: row.email ?? '', fullName: row.full_name ?? null, role: row.role, canWrite: WRITE_ROLES.includes(row.role) });

// The platform_admins row, cached for 30 seconds (a removed admin loses access within that time).
// Live columns: user_id, role_id (-> platform_roles.key), first_name, last_name, status. The email lives in auth.users.
// Only an Active admin gets in; a Suspended, Inactive or Pending one counts as not an admin.
type RoleRow = { key: string; is_active?: boolean | null };
type AdminRow = { user_id: string; status: string; first_name: string | null; last_name: string | null; platform_roles: RoleRow | RoleRow[] | null };
// The same test the database makes for a platform admin (is_platform_super): an Active row whose role is active AND is super_admin (SRV-5).
// A limited staff role (support, finance, a role someone named "operations") is not a One Local admin here: this API has no per-feature
// permission model, so it must not hand out the full one. Anything missing or unexpected in the row is a "no": it fails closed.
export const PLATFORM_ADMIN_ROLE = 'super_admin';
export const adminFromRow = (row: AdminRow, email: string | null): Admin | null => {
  if (row.status !== 'Active') return null;
  const role = Array.isArray(row.platform_roles) ? row.platform_roles[0] : row.platform_roles;
  if (!role || role.key !== PLATFORM_ADMIN_ROLE || role.is_active !== true) return null; // no role, another role, or a deactivated role
  const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ') || null;
  return { ...asAdmin({ user_id: row.user_id, email, full_name: fullName, role: role.key }), canWrite: true };
};
async function platformAdmin(userId: string): Promise<Admin | null> {
  const hit = admins.get(userId);
  if (hit && hit.until > Date.now()) return hit.admin;
  const { data, error } = await db().from('platform_admins').select('user_id, status, first_name, last_name, platform_roles(key, is_active)').eq('user_id', userId).maybeSingle();
  if (error) {
    // The table does not look the way this code expects (a migration it does not know about, a renamed column) or the database is down:
    // nobody is let in, and nothing is cached, so the next call asks again. Only the code is logged.
    console.error('[admin] the platform_admins check failed, so access is refused:', error.code ?? 'error');
    throw err(503, 'admin_unavailable', 'The admin service cannot check your access right now. Please try again shortly.');
  }
  let admin: Admin | null = null;
  if (data) {
    const email = (await db().auth.admin.getUserById(userId).catch(() => null))?.data?.user?.email ?? null;
    admin = adminFromRow(data as unknown as AdminRow, email);
  }
  if (admins.size > 1000) admins.clear();
  admins.set(userId, { admin, until: Date.now() + 30_000 });
  return admin;
}

function devAdmin(token: string): Admin | null {
  if (token === 'dev-user') return null;
  const role = token.startsWith('dev-admin:') ? token.slice('dev-admin:'.length) : '';
  if (!(market.DEV_ROLES as readonly string[]).includes(role)) {
    throw err(401, 'dev_token_required', 'Without a database this server accepts development tokens only: "dev-admin:<platform role>" or "dev-user".');
  }
  const user = market.memory().users.find(u => u.id === market.devAdminId(role));
  return asAdmin({ user_id: market.devAdminId(role), email: user?.email ?? null, full_name: `Dev ${role.replace(/_/g, ' ')}`, role });
}

export async function requireAdmin(request: Request, write: boolean): Promise<Admin> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw err(401, 'not_signed_in', 'Sign in to continue.');
  let admin: Admin | null;
  // In production dbConfigured() throws when the database is missing; here that is the admin API's own 503 below.
  const hasDb = (() => { try { return dbConfigured(); } catch { return false; } })();
  if (hasDb) {
    const userId = await signedInUserId(request);
    if (!userId) throw err(401, 'session_expired', 'Your session has expired. Please sign in again.');
    admin = await platformAdmin(userId);
  } else {
    // Development tokens ("dev-admin:<role>") stand in for sign-in with no database. They are a back door, so they are off unless
    // this development machine asks for them with ADMIN_DEV_TOKENS=1, and never in production (SRV-9 P3-4).
    if (production() || process.env.ADMIN_DEV_TOKENS !== '1') throw err(503, 'database_not_connected', 'The database is not connected yet.');
    admin = devAdmin(token);
  }
  if (!admin) throw err(403, 'not_platform_admin', 'Only One Local platform admins can use this.');
  if (write && !admin.canWrite) throw err(403, 'read_only_role', 'Your role can view One Local but not change it.');
  limit(admin.userId, write ? 'admin-write' : 'admin-read', write ? 60 : 240, 60_000);
  return admin;
}

// One line per write: who (user id and role), what, which row, when. No personal data.
export function audit(admin: Admin, action: string, target: string, extra: Record<string, string | number | boolean> = {}) {
  console.log(`[admin] ${JSON.stringify({ at: new Date().toISOString(), by: admin.userId, role: admin.role, action, target, ...extra })}`);
}

// ---------- CORS and the route wrapper ----------
function masterOrigins(): string[] {
  return (process.env.MASTER_APP_URL ?? '').split(',').map(u => {
    try { return new URL(u.trim()).origin; } catch { return ''; }
  }).filter(Boolean);
}

// The origin to answer to; null when the request is not cross-origin (server-to-server, same site);
// false when a browser on some other website is calling.
function allowedOrigin(request: Request): string | null | false {
  const origin = request.headers.get('origin');
  if (!origin || origin === new URL(request.url).origin) return null;
  if (masterOrigins().includes(origin)) return origin;
  if (!production() && /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin)) return origin;
  return false;
}

const notAllowed = () => err(403, 'origin_not_allowed', 'This website is not allowed to use the One Local admin API.');

function withCors(response: Response, origin: string, extra: Record<string, string> = {}) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Expose-Headers', 'Retry-After, X-Total-Count');
  headers.append('Vary', 'Origin');
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function errorResponse(request: Request, error: unknown): Response {
  if (error instanceof HttpError) {
    const code = error instanceof AdminError ? error.code : STATUS_CODES[error.status] ?? 'error';
    return Response.json({ detail: error.detail, code }, { status: error.status, headers: error.headers });
  }
  console.error('[admin]', request.method, new URL(request.url).pathname, error);
  return Response.json({ detail: 'Something went wrong. Please try again.', code: 'server_error' }, { status: 500 });
}

export function preflight(request: Request): Response {
  const origin = allowedOrigin(request);
  if (origin === false) return errorResponse(request, notAllowed());
  const allow = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type, x-upsert',
    'Access-Control-Max-Age': '600',
  };
  const empty = new Response(null, { status: 204, headers: { Allow: allow['Access-Control-Allow-Methods'] } });
  return origin ? withCors(empty, origin, allow) : empty;
}

type Handler = (request: Request, params: Record<string, string>) => Response | Promise<Response>;

// The address the proxy saw, never the client-written start of X-Forwarded-For (http.ts clientIp).

// Every admin route: the origin check, a per-address limit that runs before any token is looked
// up, errors as { detail, code }, and CORS headers on every answer (errors included) when a
// browser on an allowed origin is calling.
export function adminRoute(handler: Handler): Handler {
  return async (request, params) => {
    const origin = allowedOrigin(request);
    let response: Response;
    try {
      if (origin === false) throw notAllowed();
      limit(clientIp(request), 'admin-address', 300, 60_000);
      response = await handler(request, params ?? {});
    } catch (error) {
      response = errorResponse(request, error);
    }
    return origin ? withCors(response, origin) : response;
  };
}

// Page through a list: ?page=1 (the default) is the first 50. X-Total-Count says how many in all.
export const PER_PAGE = 50;
export type Paged<T> = { rows: T[]; total: number };
function page<T>(request: Request, all: T[]): Paged<T> {
  const raw = new URL(request.url).searchParams.get('page');
  const n = raw === null || raw === '' ? 1 : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 10_000) throw bad('page must be a whole number from 1.');
  return { rows: all.slice((n - 1) * PER_PAGE, n * PER_PAGE), total: all.length };
}
export const paged = <T>(result: Paged<T>) => Response.json(result.rows, { headers: { 'X-Total-Count': String(result.total) } });

// ---------- Me and organizations ----------
export async function me(request: Request) {
  const admin = await requireAdmin(request, false);
  return { user_id: admin.userId, email: admin.email, full_name: admin.fullName, role: admin.role, can_write: admin.canWrite };
}

function searchText(request: Request) {
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase();
  if (q.length > 80) throw bad('Please use a shorter search.');
  return q;
}

const statusOf = (row: StoreRow) => row.status ?? 'live';
// The listing that best represents an organization: live first, then pending, then the newest.
const rank = (row: StoreRow) => ['live', 'pending', 'paused', 'draft'].indexOf(statusOf(row));

export async function organizations(request: Request) {
  await requireAdmin(request, false);
  const q = searchText(request);
  const orgs = (await market.readOrganizations())
    .filter(o => !q || `${o.name} ${o.slug}`.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 200);
  const ids = orgs.map(o => o.id);
  const [locations, im, listings] = await Promise.all([market.readLocations(ids), market.readItemMaster(ids), market.readListingRows({ organizationIds: ids })]);
  return orgs.map(o => {
    const own = listings.filter(l => l.organization_id === o.id);
    const best = [...own].sort((a, b) => rank(a) - rank(b) || (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
    return {
      id: o.id, name: o.name, slug: o.slug,
      locations: locations.filter(l => l.organization_id === o.id).map(l => ({ id: l.id, name: l.name, city: l.city, address: l.address })),
      items: im.items.filter(i => i.organization_id === o.id).length,
      categories: im.categories.filter(c => c.organization_id === o.id).length,
      items_live: market.itemsLive(o.id, im),
      listing: best ? { id: best.id, status: statusOf(best) } : null,
      listings: own.map(l => ({ id: l.id, status: statusOf(l), location_id: l.location_id ?? null })),
    };
  });
}

// ---------- Listings: reading ----------
export type Listing = {
  id: string; organization_id: string; organization_name: string; location_id: string | null; location_name: string | null; name: string;
  department: string | null; city_id: string; status: string; tagline: string | null; logo: string | null;
  cover_image: string | null; address: string | null; lat: number | null; lng: number | null;
  delivery_radius_km: number | null; delivery_time: string | null; items_live: number;
  approved_at: string | null; created_at: string | null; updated_at: string | null;
};

async function requireListingColumns() {
  if (await market.listingColumnsReady()) return;
  throw err(503, 'migration_required', "Apply migration 0028 first: One Local's database does not have the listing columns yet (db/migrations/0028_ol_marketplace_listings.sql).");
}

// Listing rows with what the Master shows next to them: organization name, pickup address (kept in
// ol_merchant_channels, else the outlet's address) and how many items are live on One Local.
async function hydrate(rows: StoreRow[]): Promise<Listing[]> {
  const orgIds = rows.map(r => r.organization_id);
  const [im, channels, locations] = await Promise.all([market.readItemMaster(orgIds), market.readChannels(orgIds), market.readLocations(orgIds)]);
  return rows.map(r => {
    const channel = channels.find(c => c.organization_id === r.organization_id);
    const own = channel && (!channel.store_id || channel.store_id === r.id) ? channel : undefined;
    const location = r.location_id ? locations.find(l => l.id === r.location_id) : undefined;
    return {
      id: r.id, organization_id: r.organization_id!, organization_name: im.organizations.find(o => o.id === r.organization_id)?.name ?? '',
      location_id: r.location_id ?? null, location_name: location?.name ?? null, name: r.name, department: r.department, city_id: r.city_id, status: statusOf(r),
      tagline: r.tagline ?? null, logo: r.logo ?? null, cover_image: r.cover_image ?? null,
      address: own?.address ?? location?.address ?? null,
      lat: market.numOrNull(r.lat ?? own?.lat), lng: market.numOrNull(r.lng ?? own?.lng), delivery_radius_km: market.numOrNull(r.delivery_radius_km),
      delivery_time: r.delivery_time ?? null, items_live: market.itemsLive(r.organization_id!, im),
      approved_at: r.approved_at ?? null, created_at: r.created_at ?? null, updated_at: r.updated_at ?? r.created_at ?? null,
    };
  });
}

async function listingOr404(id: string): Promise<StoreRow> {
  const [row] = /^[\w.-]{1,100}$/.test(id) ? await market.readListingRows({ id }) : [];
  if (!row) throw notFound('Listing');
  return row;
}
const listing = async (id: string) => (await hydrate([await listingOr404(id)]))[0];

export async function getListing(request: Request, id: string) {
  await requireAdmin(request, false);
  await requireListingColumns();
  return listing(id);
}

export async function listListings(request: Request): Promise<Paged<Listing>> {
  await requireAdmin(request, false);
  await requireListingColumns();
  const params = new URL(request.url).searchParams;
  const status = params.get('status');
  const city = params.get('city');
  if (status && !(market.LISTING_STATUSES as readonly string[]).includes(status)) throw bad('Status must be draft, pending, live or paused.');
  if (city && !/^[a-z0-9-]{2,40}$/.test(city)) throw bad('Unknown city.');
  const rows = (await market.readListingRows())
    .filter(r => (!status || statusOf(r) === status) && (!city || r.city_id === city))
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || a.id.localeCompare(b.id));
  const one = page(request, rows);
  return { rows: await hydrate(one.rows), total: one.total };
}

// What the app will show for this listing, whatever its status: the listing, and every item of the
// organization's Item Master by menu category, each marked with whether One Local shows it.
export async function previewListing(request: Request, id: string) {
  await requireAdmin(request, false);
  await requireListingColumns();
  const row = await listingOr404(id);
  const [store] = await hydrate([row]);
  const categories = market.itemPreview(row.organization_id!, await market.readItemMaster([row.organization_id]));
  return { store, categories, items_live: store.items_live };
}

// ---------- Listings: checking what the Master sends ----------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITABLE = ['organization_id', 'location_id', 'name', 'department', 'city_id', 'tagline', 'logo', 'cover_image', 'address', 'lat', 'lng', 'delivery_radius_km', 'delivery_time'] as const;
type ListingInput = {
  organization_id?: string; location_id?: string | null; name?: string; department?: market.Department; city_id?: string;
  tagline?: string | null; logo?: string | null; cover_image?: string | null; address?: string; lat?: number; lng?: number;
  delivery_radius_km?: number | null; delivery_time?: string | null;
};
const REQUIRED: (keyof ListingInput)[] = ['organization_id', 'name', 'department', 'city_id', 'address', 'lat', 'lng'];


function text(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== 'string') throw bad(`${label} must be text.`);
  const t = value.replace(/\s+/g, ' ').trim();
  if (t.length < min || t.length > max) throw bad(`${label} must be ${min} to ${max} characters.`);
  return t;
}

// Images are public links: the URL an upload returned (https), or a catalogue media path.
function image(value: unknown, label: string) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 500) throw bad(`${label} must be an image link.`);
  if (/^\/api\/media\/[\w.-]{1,120}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || (!production() && url.protocol === 'http:')) return value;
  } catch {}
  throw bad(`${label} must be an https link to the image.`);
}

function parseListing(body: Record<string, unknown>, partial: boolean): ListingInput {
  const extra = Object.keys(body).filter(k => !(EDITABLE as readonly string[]).includes(k));
  if (extra.includes('status')) throw bad('Change the status with POST /api/admin/listings/:id/status.');
  if (extra.length) throw bad(`Unknown field: ${extra[0]}.`);
  if (!partial) for (const k of REQUIRED) if (body[k] === undefined || body[k] === null || body[k] === '') throw bad(`${k} is required.`);
  const has = (k: string) => body[k] !== undefined;
  const out: ListingInput = {};
  if (has('organization_id')) {
    if (typeof body.organization_id !== 'string' || !UUID.test(body.organization_id)) throw bad('organization_id must be an organization id.');
    out.organization_id = body.organization_id;
  }
  if (has('location_id')) {
    if (body.location_id !== null && (typeof body.location_id !== 'string' || !UUID.test(body.location_id))) throw bad('location_id must be an outlet id or null.');
    out.location_id = body.location_id as string | null;
  }
  if (has('name')) out.name = text(body.name, 'Name', 2, 80);
  if (has('department')) {
    if (!(market.DEPARTMENTS as readonly unknown[]).includes(body.department)) throw bad(`Department must be one of ${market.DEPARTMENTS.join(', ')}.`);
    out.department = body.department as market.Department;
  }
  if (has('city_id')) {
    if (typeof body.city_id !== 'string' || !/^[a-z0-9-]{2,40}$/.test(body.city_id)) throw bad('city_id must be a city id such as latur.');
    out.city_id = body.city_id;
  }
  if (has('tagline')) out.tagline = body.tagline === null || body.tagline === '' ? null : text(body.tagline, 'Tagline', 2, 120);
  if (has('logo')) out.logo = image(body.logo, 'Logo');
  if (has('cover_image')) out.cover_image = image(body.cover_image, 'Cover image');
  if (has('address')) out.address = text(body.address, 'Address', 5, 300);
  // The map point must be in India; this also catches latitude and longitude typed the wrong way round.
  if (has('lat') || has('lng')) {
    const lat = has('lat') ? body.lat : 20, lng = has('lng') ? body.lng : 78;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !(lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98)) {
      throw bad('Pick the store on the map: lat and lng must be a point in India.');
    }
    if (has('lat')) out.lat = lat;
    if (has('lng')) out.lng = lng;
  }
  if (has('delivery_radius_km')) {
    const r = body.delivery_radius_km;
    if (r !== null && (typeof r !== 'number' || !(r >= 0.5 && r <= 50))) throw bad('Delivery radius must be 0.5 to 50 km.');
    out.delivery_radius_km = r === null ? null : Math.round((r as number) * 100) / 100;
  }
  if (has('delivery_time')) out.delivery_time = body.delivery_time === null || body.delivery_time === '' ? null : text(body.delivery_time, 'Delivery time', 1, 20);
  return out;
}

async function requireCity(city: string) {
  if (!dbConfigured()) {
    if (city !== 'latur') throw bad('One Local does not deliver in that city yet.');
    return;
  }
  const { data, error } = await db().from('ol_service_areas').select('*').eq('city_id', city).maybeSingle();
  if (error) fromDbError(error);
  if (!data || data.deleted_at) throw bad('One Local does not deliver in that city yet.');
}

async function organizationOr404(id: string) {
  if (!dbConfigured()) {
    const org = market.memory().organizations.find(o => o.id === id);
    if (!org) throw notFound('Organization');
    return org;
  }
  const { data, error } = await db().from('organizations').select('id, name, slug').eq('id', id).maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw notFound('Organization');
  return data as market.OrgRow;
}

async function outletOf(organizationId: string, locationId: string) {
  const outlet = (await market.readLocations([organizationId])).find(l => l.id === locationId);
  if (!outlet) throw bad('That outlet does not belong to this organization.');
  return outlet;
}

// Another listing (any status, not deleted) for the same organization and outlet.
async function sameOutlet(organizationId: string, locationId: string | null, except?: string) {
  return (await market.readListingRows({ organizationIds: [organizationId] }))
    .find(r => r.id !== except && (r.location_id ?? null) === (locationId ?? null));
}

// ---------- Listings: writing ----------
async function freeStoreId(base: string) {
  const candidates = [base, ...Array.from({ length: 19 }, (_, i) => `${base}-${i + 2}`)];
  let taken: Set<string>;
  if (!dbConfigured()) {
    taken = new Set(market.memory().stores.map(s => s.id));
  } else {
    const { data, error } = await db().from('ol_stores').select('id').in('id', candidates);
    if (error) fromDbError(error);
    taken = new Set((data ?? []).map(r => r.id as string));
  }
  const id = candidates.find(c => !taken.has(c));
  if (!id) throw err(409, 'conflict', 'Too many listings already use this name.');
  return id;
}

async function insertStore(row: StoreRow) {
  if (!dbConfigured()) {
    const now = new Date().toISOString();
    market.memory().stores.push({ rating: 4.5, tags: [], media: [], sort_order: 0, created_at: now, updated_at: now, ...row });
    return;
  }
  const { error } = await db().from('ol_stores').insert(row);
  if (error?.code === '23505') throw err(409, 'conflict', 'Another listing was saved with the same id a moment ago. Please try again.');
  if (error) fromDbError(error);
}

async function updateStore(id: string, patch: Partial<StoreRow>) {
  if (!dbConfigured()) {
    const row = market.memory().stores.find(s => s.id === id);
    if (row) Object.assign(row, patch, { updated_at: new Date().toISOString() });
    return;
  }
  const { error } = await db().from('ol_stores').update(patch).eq('id', id);
  // The unique index from 0028: one live listing per organization and outlet.
  if (error?.code === '23505') throw err(409, 'outlet_already_live', 'This organization already has a live listing for this outlet.');
  if (error) fromDbError(error);
}

// The pickup address and point live in ol_merchant_channels, one row per organization. A new
// listing takes the row over (the contract's upsert); an edit only changes it while the row
// belongs to this listing. A new row starts with accepting = false: the restaurant switches
// One Local orders on in VINII Partner.
async function saveChannel(organizationId: string, storeId: string, fields: { address?: string; lat?: number; lng?: number; city_id?: string }, by: string, takeOver: boolean) {
  const [existing] = await market.readChannels([organizationId]);
  if (existing && existing.store_id && existing.store_id !== storeId && !takeOver) return;
  const changes = Object.fromEntries(Object.entries({ ...fields, store_id: storeId, updated_by: by }).filter(([, v]) => v !== undefined));
  if (!dbConfigured()) {
    const m = market.memory();
    if (existing) Object.assign(m.channels.find(c => c.organization_id === organizationId)!, changes);
    else m.channels.push({ organization_id: organizationId, accepting: false, address: null, lat: null, lng: null, city_id: 'latur', store_id: storeId, ...changes });
    return;
  }
  const { error } = existing
    ? await db().from('ol_merchant_channels').update(changes).eq('organization_id', organizationId)
    : await db().from('ol_merchant_channels').insert({ organization_id: organizationId, accepting: false, ...changes });
  if (error) fromDbError(error);
}

export async function createListing(request: Request) {
  const admin = await requireAdmin(request, true);
  await requireListingColumns();
  const input = parseListing(await readBody(request), false);
  const org = await organizationOr404(input.organization_id!);
  const outlet = input.location_id ? await outletOf(org.id, input.location_id) : null;
  await requireCity(input.city_id!);
  const clash = await sameOutlet(org.id, input.location_id ?? null);
  if (clash) throw err(409, 'listing_exists', `This organization already has a One Local listing${outlet ? ' for this outlet' : ''}: ${clash.id}.`);
  const base = ['org', market.slugify(org.slug) || org.id.slice(0, 8), outlet ? market.slugify(outlet.code || outlet.name) : ''].filter(Boolean).join('-').slice(0, 80);
  const id = await freeStoreId(base);
  await insertStore({
    id, name: input.name!, logo: input.logo ?? null, tagline: input.tagline ?? null, delivery_time: input.delivery_time ?? '30 min',
    department: input.department!, organization_id: org.id, city_id: input.city_id!, is_demo: false, status: 'pending',
    location_id: input.location_id ?? null, cover_image: input.cover_image ?? null, lat: input.lat!, lng: input.lng!,
    delivery_radius_km: input.delivery_radius_km ?? null, created_by: admin.userId, updated_by: admin.userId,
  });
  await saveChannel(org.id, id, { address: input.address, lat: input.lat, lng: input.lng, city_id: input.city_id }, admin.userId, true);
  audit(admin, 'listing.create', id, { organization: org.id });
  invalidateCatalog();
  return listing(id);
}

export async function updateListing(request: Request, id: string) {
  const admin = await requireAdmin(request, true);
  await requireListingColumns();
  const row = await listingOr404(id);
  const { organization_id, address, ...fields } = parseListing(await readBody(request), true);
  if (organization_id !== undefined && organization_id !== row.organization_id) throw bad('A listing cannot move to another organization. Create a new listing instead.');
  if (fields.location_id !== undefined && (fields.location_id ?? null) !== (row.location_id ?? null)) {
    if (fields.location_id) await outletOf(row.organization_id!, fields.location_id);
    const clash = await sameOutlet(row.organization_id!, fields.location_id ?? null, id);
    if (clash) throw err(409, 'listing_exists', `This outlet already has a One Local listing: ${clash.id}.`);
  }
  if (fields.city_id !== undefined) await requireCity(fields.city_id);
  const changes = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<StoreRow>;
  if (!Object.keys(changes).length && address === undefined) throw bad('Nothing to change.');
  if (Object.keys(changes).length) await updateStore(id, { ...changes, updated_by: admin.userId });
  if (address !== undefined || fields.lat !== undefined || fields.lng !== undefined || fields.city_id !== undefined) {
    await saveChannel(row.organization_id!, id, { address, lat: fields.lat, lng: fields.lng, city_id: fields.city_id }, admin.userId, false);
  }
  audit(admin, 'listing.update', id, { fields: [...Object.keys(changes), ...(address !== undefined ? ['address'] : [])].join(',') });
  invalidateCatalog();
  return listing(id);
}

// live needs at least one item available on One Local and no other live listing for the outlet;
// it records who approved it and when. paused / pending take the store off the app at once.
export async function setListingStatus(request: Request, id: string) {
  const admin = await requireAdmin(request, true);
  await requireListingColumns();
  const row = await listingOr404(id);
  const body = await readBody(request);
  const status = body.status;
  if (status !== 'live' && status !== 'paused' && status !== 'pending') throw bad('Status must be live, paused or pending.');
  if (body.reason !== undefined && body.reason !== null && (typeof body.reason !== 'string' || body.reason.length > 300)) throw bad('Keep the reason to 300 characters.');
  if (status === 'paused' && !(typeof body.reason === 'string' && body.reason.trim())) throw bad('Say why the listing is being paused.', 'reason_required');
  if (status === 'live') {
    const items = market.itemsLive(row.organization_id!, await market.readItemMaster([row.organization_id]));
    if (!items) throw err(409, 'no_available_items', 'This organization has no items available on One Local yet. Add items in the Merchant portal (or switch them on for One Local) first.');
    const live = (await market.readListingRows({ organizationIds: [row.organization_id!] }))
      .find(r => r.id !== id && statusOf(r) === 'live' && (r.location_id ?? null) === (row.location_id ?? null));
    if (live) throw err(409, 'outlet_already_live', `Another listing for this outlet is already live: ${live.id}. Pause it first.`);
    await updateStore(id, { status, approved_by: admin.userId, approved_at: new Date().toISOString(), updated_by: admin.userId });
  } else {
    await updateStore(id, { status, updated_by: admin.userId });
  }
  audit(admin, `listing.${status}`, id, { from: statusOf(row), reason_given: typeof body.reason === 'string' && body.reason.trim().length > 0 });
  invalidateCatalog();
  return listing(id);
}

// ---------- Media ----------
// A signed upload link into the public onecity-catalog bucket: the Master PUTs the file straight to
// Supabase Storage (it never passes through this server) and saves public_url on the listing.
// Supabase cannot cap one signed link's size, so 5 MB is checked here when the Master sends the
// file size, and the bucket's own limit is the hard ceiling.
export const BUCKET = 'onecity-catalog';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string[]> = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
// Marketing pop-up creatives (specs/marketing-popups): photos up to 2 MB, MP4 videos up to 15 MB (30 s).
const POPUP_TYPES: Record<string, string[]> = { ...IMAGE_TYPES, 'video/mp4': ['mp4'] };
const POPUP_MAX_BYTES = (type: string) => (type.startsWith('video/') ? 15 : 2) * 1024 * 1024;

const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');

export async function uploadUrl(request: Request) {
  const admin = await requireAdmin(request, true);
  limit(admin.userId, 'admin-upload', 30, 60_000);
  const body = await readBody(request);
  if (body.folder !== 'stores' && body.folder !== 'popups') throw bad('folder must be "stores" or "popups".');
  const folder = body.folder as 'stores' | 'popups';
  const types = folder === 'popups' ? POPUP_TYPES : IMAGE_TYPES;
  const maxBytes = folder === 'popups' ? POPUP_MAX_BYTES(typeof body.content_type === 'string' ? body.content_type.trim().toLowerCase() : '') : MAX_IMAGE_BYTES;
  const type = typeof body.content_type === 'string' ? body.content_type.trim().toLowerCase() : '';
  if (!types[type]) throw bad(folder === 'popups' ? 'Only JPEG, PNG or WebP photos or MP4 videos can be uploaded.' : 'Only JPEG, PNG or WebP images can be uploaded.');
  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  const parts = filename.match(/^([^/\\\0]{1,100})\.([A-Za-z0-9]{2,5})$/);
  if (!parts) throw bad('filename must be a plain file name such as logo.jpg.');
  const ext = parts[2].toLowerCase();
  if (!types[type].includes(ext)) throw bad(`A ${type} file must end in .${types[type].join(' or .')}.`);
  const size = body.size ?? body.bytes;
  if (size !== undefined && (typeof size !== 'number' || !(size > 0))) throw bad('size must be the file size in bytes.');
  if (typeof size === 'number' && size > maxBytes) throw err(413, 'too_large', `This file can be at most ${maxBytes / 1024 / 1024} MB.`);

  const name = `${randomHex(8)}-${market.slugify(parts[1]) || 'image'}.${ext}`;
  const now = new Date();
  const path = `${folder}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${name}`;
  let upload: string, published: string;
  if (dbConfigured()) {
    const bucket = db().storage.from(BUCKET);
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error || !data) {
      console.error('[admin] signed upload link failed:', error?.message);
      throw err(502, 'upstream_error', 'Could not prepare the upload. Please try again.');
    }
    upload = data.signedUrl;
    published = bucket.getPublicUrl(path).data.publicUrl;
  } else {
    // Memory mode: this server takes the upload itself (PUT /api/admin/media/dev/<name>) and serves it back.
    market.memory().uploads.set(name, { content_type: type, expires: Date.now() + 2 * 3_600_000 });
    upload = published = `${new URL(request.url).origin}/api/admin/media/dev/${name}`;
  }
  audit(admin, 'media.upload_url', path);
  // Supabase signed upload links are valid for 2 hours. PUT the file body with exactly these headers.
  return {
    upload_url: upload, public_url: published, path, method: 'PUT', headers: { 'Content-Type': type, 'x-upsert': 'false' },
    content_type: type, max_bytes: maxBytes, expires_in: 7200,
  };
}

function devUploadEntry(key: string) {
  if (dbConfigured() || production()) throw notFound('Upload');
  const entry = /^[\w.-]{1,160}$/.test(key) ? market.memory().uploads.get(key) : undefined;
  if (!entry || (!entry.bytes && entry.expires < Date.now())) throw err(404, 'not_found', 'This upload link has expired.');
  return entry;
}

// Memory mode only: the stand-in for a Supabase signed upload link. The random name is the key.
export async function devUpload(request: Request, key: string) {
  const entry = devUploadEntry(key);
  if (entry.bytes) throw err(409, 'upload_used', 'This upload link was already used.');
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== entry.content_type) throw bad(`Upload the file as ${entry.content_type}.`);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) throw err(413, 'too_large', 'Images can be at most 5 MB.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength) throw bad('The file is empty.');
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw err(413, 'too_large', 'Images can be at most 5 MB.');
  entry.bytes = bytes;
  return { key, bytes: bytes.byteLength };
}

export function devFile(key: string): Response {
  const entry = devUploadEntry(key);
  if (!entry.bytes) throw err(404, 'not_found', 'Not uploaded yet.');
  return new Response(entry.bytes.slice().buffer as ArrayBuffer, { headers: { 'Content-Type': entry.content_type, 'Cache-Control': 'public, max-age=3600' } });
}

// ---------- Shoppers ----------
// Supabase Auth users (one project for every app, so staff and admins are users too). Read page by
// page and kept for 30 seconds so typing in the Master's search box does not rescan every account.
let usersCache: { at: number; users: market.AuthUser[] } | null = null;

async function authUsers(): Promise<market.AuthUser[]> {
  if (!dbConfigured()) return market.memory().users;
  if (usersCache && Date.now() - usersCache.at < 30_000) return usersCache.users;
  const users: market.AuthUser[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.error('[admin] listUsers failed:', error.message);
      throw err(502, 'upstream_error', 'Could not read shoppers right now. Please try again.');
    }
    users.push(...data.users.map(u => ({
      id: u.id, email: u.email ?? null, phone: u.phone || null, created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null, banned_until: u.banned_until ?? null,
    })));
    if (data.users.length < 1000) break;
  }
  usersCache = { at: Date.now(), users };
  return users;
}

const blockedNow = (u: market.AuthUser) => !!u.banned_until && Date.parse(u.banned_until) > Date.now();

// Orders per shopper. A checkout split over several stores (migration 0026) is one order to the
// shopper; before 0026 every ol_orders row is its own order.
let checkoutColumn: boolean | null = null;
type OrderRef = { id: string; user_id: string | null; checkout_id?: string | null };
const memoryStore = () => (globalThis as unknown as { __onecityStore?: { orders?: OrderRef[]; support?: { reference?: string; message?: string; created_at?: string }[] } }).__onecityStore;

async function orderCounts(userIds: string[]) {
  let rows: OrderRef[] = [];
  if (!userIds.length) {
    rows = [];
  } else if (!dbConfigured()) {
    rows = (memoryStore()?.orders ?? []).filter(o => o.user_id && userIds.includes(o.user_id));
  } else {
    if (checkoutColumn === null) {
      const { error } = await db().from('ol_orders').select('checkout_id').limit(1);
      if (error && error.code !== '42703') fromDbError(error);
      checkoutColumn = !error;
    }
    const columns = checkoutColumn ? 'id, user_id, checkout_id' : 'id, user_id';
    rows = await market.selectAll<OrderRef>((a, b) => db().from('ol_orders').select(columns).in('user_id', userIds).order('id').range(a, b) as unknown as PromiseLike<{ data: OrderRef[] | null; error: { code?: string } | null }>);
  }
  const orders = new Map<string, Set<string>>();
  for (const o of rows) {
    if (!o.user_id) continue;
    orders.set(o.user_id, (orders.get(o.user_id) ?? new Set()).add(o.checkout_id ?? o.id));
  }
  return new Map([...orders].map(([user, set]) => [user, set.size]));
}

// Newest first, 50 per page (?page=); without ?q= the first page is the 50 most recent accounts.
export async function shoppers(request: Request) {
  const admin = await requireAdmin(request, false);
  limit(admin.userId, 'admin-shoppers', 60, 60_000);
  const q = searchText(request);
  const digits = q.replace(/\D/g, '');
  const found = page(request, (await authUsers())
    .filter(u => !q || (u.email ?? '').toLowerCase().includes(q) || (digits.length >= 3 && (u.phone ?? '').replace(/\D/g, '').includes(digits)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)));
  const orders = await orderCounts(found.rows.map(u => u.id));
  return {
    total: found.total,
    rows: found.rows.map(u => ({
      id: u.id, email: u.email, phone: u.phone, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
      orders: orders.get(u.id) ?? 0, blocked: blockedNow(u),
    })),
  };
}

async function isPlatformAdmin(userId: string) {
  if (!dbConfigured()) return !!market.memory().users.find(u => u.id === userId)?.platform_role;
  const { data, error } = await db().from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) fromDbError(error);
  return !!data;
}

async function isMerchantStaff(userId: string) {
  if (!dbConfigured()) return !!market.memory().users.find(u => u.id === userId)?.staff;
  const { data, error } = await db().from('org_users').select('user_id').eq('user_id', userId).eq('status', 'active').limit(1);
  if (error && !['PGRST205', '42P01'].includes(error.code ?? '')) fromDbError(error);
  return !!data?.length;
}

// A Supabase Auth ban: the person cannot sign in (or refresh a session) until unblocked. Nothing is
// deleted. Platform admins and merchant staff are refused: the same login opens the Master and the
// POS, so blocking them here would lock them out of work.
export async function blockShopper(request: Request, id: string) {
  const admin = await requireAdmin(request, true);
  limit(admin.userId, 'admin-block', 30, 60_000);
  if (!UUID.test(id)) throw notFound('Shopper');
  const body = await readBody(request);
  if (typeof body.blocked !== 'boolean') throw bad('Say whether the shopper is blocked: blocked true or false.');
  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') throw bad('reason must be text.');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length > 300) throw bad('Keep the reason to 300 characters.');
  if (body.blocked && reason.length < 3) throw bad('Give a short reason for blocking.');
  if (await isPlatformAdmin(id)) throw err(409, 'cannot_block_admin', 'Platform admins cannot be blocked here.');
  if (body.blocked && (await isMerchantStaff(id))) {
    throw err(409, 'cannot_block_staff', "This person is on a merchant's staff: blocking them would also lock them out of the POS. Remove them from the organization in the Master first.");
  }
  if (!dbConfigured()) {
    const user = market.memory().users.find(u => u.id === id);
    if (!user) throw notFound('Shopper');
    user.banned_until = body.blocked ? new Date(Date.now() + 876_000 * 3_600_000).toISOString() : null;
  } else {
    const { error } = await db().auth.admin.updateUserById(id, { ban_duration: body.blocked ? '876000h' : 'none' });
    if (error) {
      if (error.status === 404 || /not found/i.test(error.message)) throw notFound('Shopper');
      console.error('[admin] ban change failed:', error.message);
      throw err(502, 'upstream_error', 'Could not change the block right now. Please try again.');
    }
    usersCache = null;
  }
  audit(admin, body.blocked ? 'shopper.block' : 'shopper.unblock', id, { reason_given: reason.length > 0 });
  return { id, blocked: body.blocked };
}

// ---------- Demand ----------
// "Bring One Local to my town" requests (store.ts createLaunchRequest), counted per place.
type LaunchRow = { reference: string; message: string; created_at: string };
const placeName = (r: LaunchRow) => r.message.match(/^Please launch One Local in (.+) \(-?[\d.]+, -?[\d.]+\)\.$/)?.[1] ?? r.reference.slice('launch:'.length);

export async function demand(request: Request) {
  await requireAdmin(request, false);
  const rows: LaunchRow[] = !dbConfigured()
    ? (memoryStore()?.support ?? []).filter((r): r is LaunchRow => typeof r.reference === 'string' && r.reference.startsWith('launch:') && typeof r.message === 'string' && typeof r.created_at === 'string')
    : await market.selectAll<LaunchRow>((a, b) => db().from('ol_support_requests').select('reference, message, created_at').like('reference', 'launch:%').order('created_at', { ascending: false }).range(a, b));
  const places = new Map<string, { place: string; place_id: string; requests: number; last_at: string }>();
  for (const r of rows) {
    const p = places.get(r.reference) ?? { place: placeName(r), place_id: r.reference.slice('launch:'.length), requests: 0, last_at: r.created_at };
    p.requests++;
    if (r.created_at > p.last_at) p.last_at = r.created_at;
    places.set(r.reference, p);
  }
  return [...places.values()].sort((a, b) => b.requests - a.requests || b.last_at.localeCompare(a.last_at));
}
