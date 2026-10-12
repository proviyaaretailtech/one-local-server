// Marketplace listings (One Local store pages the Master approves) and the Item Master they sell
// from. Shared by the catalogue (catalog.ts: what customers see) and the admin API (admin.ts: what
// the Master edits). See docs/MASTER_CONTRACT_V1.md.
//
// One source of truth: a listing is an ol_stores row with organization_id set and is_demo = false.
// Its categories, items, prices and photos are the organization's own POS rows (menu_categories,
// menu_items, pos_menu_item_variants). An item is hidden on One Local while it is unavailable in the POS
// or switched off for the 'one_local' channel in item_channel_status (is_available = false and
// off_until empty or still in the future) — the same rule the VINII Partner app uses (restaurant.ts).
//
// With no database (npx expo start, no .env) everything lives in memory, seeded with two sample
// organizations, so the Master can be developed against this server.
import { db, dbConfigured, fromDbError } from './db';

export const DEPARTMENTS = ['food', 'grocery', 'shops', 'pharmacy', 'beauty'] as const;
export type Department = (typeof DEPARTMENTS)[number];
export const LISTING_STATUSES = ['draft', 'pending', 'live', 'paused'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

// ---------- Rows ----------
// An ol_stores row. The fields marked 0028 exist only once migration 0028 is applied.
export type StoreRow = {
  id: string; name: string; logo: string | null; tagline: string | null; delivery_time: string | null;
  rating?: number | string; tags?: string[] | null; department: string | null; media?: unknown[] | null;
  organization_id: string | null; city_id: string; is_demo: boolean; sort_order?: number;
  created_at?: string; created_by?: string | null; updated_by?: string | null; deleted_at?: string | null;
  status?: ListingStatus; location_id?: string | null; cover_image?: string | null;                 // 0028
  lat?: number | null; lng?: number | null; delivery_radius_km?: number | string | null;             // 0028
  approved_by?: string | null; approved_at?: string | null; updated_at?: string;                    // 0028
};
export type OrgRow = { id: string; name: string; slug: string };
export type LocationRow = { id: string; organization_id: string; name: string; city: string | null; address: string | null; code: string | null };
export type MenuCategoryRow = { id: string; organization_id: string; name: string; sort_order: number };
export type MenuItemRow = {
  id: string; organization_id: string; category_id: string | null; name: string; price: number | string;
  image_url: string | null; is_available: boolean; sort_order: number;
};
export type VariantRow = { id: string; organization_id: string; menu_item_id: string; name: string; price: number | string; is_default: boolean; sort_order: number };
export type SwitchRow = { menu_item_id: string; organization_id: string; is_available: boolean; off_until: string | null };
export type ChannelRow = {
  organization_id: string; store_id: string | null; accepting: boolean; address: string | null;
  lat: number | null; lng: number | null; city_id: string; updated_by?: string | null;
};
export type ItemMaster = { organizations: OrgRow[]; categories: MenuCategoryRow[]; items: MenuItemRow[]; variants: VariantRow[]; switches: SwitchRow[] };
export type AuthUser = { id: string; email: string | null; phone: string | null; created_at: string; last_sign_in_at: string | null; banned_until: string | null };

const EMPTY_ITEM_MASTER: ItemMaster = { organizations: [], categories: [], items: [], variants: [], switches: [] };

// ---------- Rules ----------
export const isListing = (row: StoreRow) => !!row.organization_id && row.is_demo === false;
// Before 0028 there is no status column; every row then counts as live, exactly as before.
export const isVisible = (row: StoreRow) => !row.deleted_at && (row.status ?? 'live') === 'live';

export function onForOneLocal(item: MenuItemRow, off: SwitchRow | undefined, now = Date.now()) {
  if (!item.is_available) return false;
  if (!off || off.is_available) return true;
  return !!off.off_until && Date.parse(off.off_until) <= now; // switched off until a time now past = on again
}

// Postgres numeric arrives as a string; the API always answers with JSON numbers.
export const num = (v: unknown, fallback = 0) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v));
export const numOrNull = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// What an item sells as: one option per variant ("Half", "Full"), or the item itself at its own
// price. A ₹0 option is a POS placeholder, not something to sell.
function optionsOf(item: MenuItemRow, variants: VariantRow[] | undefined) {
  const all = variants?.length ? variants.map(v => ({ variant: v, label: v.name, price: num(v.price) })) : [{ variant: null, label: '', price: num(item.price) }];
  return all.filter(o => o.price > 0);
}

function variantsByItem(im: ItemMaster) {
  const byItem = new Map<string, VariantRow[]>();
  for (const v of [...im.variants].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))) {
    byItem.set(v.menu_item_id, [...(byItem.get(v.menu_item_id) ?? []), v]);
  }
  return byItem;
}

// Items the app shows for this organization: on for One Local and with something to sell.
export function itemsLive(organizationId: string, im: ItemMaster, now = Date.now()) {
  const switches = new Map(im.switches.map(s => [s.menu_item_id, s]));
  const variants = variantsByItem(im);
  return im.items.filter(i => i.organization_id === organizationId && onForOneLocal(i, switches.get(i.id), now) && optionsOf(i, variants.get(i.id)).length > 0).length;
}

// The Master's preview of an organization's items: every POS item grouped by its menu category,
// with whether the app shows it (the same rule as the catalogue). The price is the default
// variant's, else the item's own; all variants are listed.
export type PreviewItem = { id: string; name: string; price: number; image: string | null; available_on_one_local: boolean; variants: { id: string; name: string; price: number }[] };
export type PreviewCategory = { id: string; name: string; items: PreviewItem[] };

export function itemPreview(organizationId: string, im: ItemMaster, now = Date.now()): PreviewCategory[] {
  const switches = new Map(im.switches.map(s => [s.menu_item_id, s]));
  const variants = variantsByItem(im);
  const categories = im.categories.filter(c => c.organization_id === organizationId).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const items = im.items.filter(i => i.organization_id === organizationId).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const view = (i: MenuItemRow): PreviewItem => {
    const own = variants.get(i.id) ?? [];
    const shown = own.find(v => v.is_default) ?? own[0];
    return {
      id: i.id, name: i.name, price: num(shown ? shown.price : i.price), image: i.image_url || null,
      available_on_one_local: onForOneLocal(i, switches.get(i.id), now) && optionsOf(i, own).length > 0,
      variants: own.map(v => ({ id: v.id, name: v.name, price: num(v.price) })),
    };
  };
  const groups = categories.map(c => ({ id: c.id, name: c.name, items: items.filter(i => i.category_id === c.id).map(view) }));
  const loose = items.filter(i => !i.category_id || !categories.some(c => c.id === i.category_id));
  if (loose.length) groups.push({ id: 'uncategorized', name: 'More', items: loose.map(view) });
  return groups.filter(g => g.items.length);
}

export const slugify = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');

// ---------- Memory mode (no database) ----------
export type MemoryShopper = AuthUser & { platform_role?: string; staff?: boolean };
type Upload = { content_type: string; expires: number; bytes?: Uint8Array };
type MemoryMarket = {
  organizations: OrgRow[]; locations: LocationRow[]; categories: MenuCategoryRow[]; items: MenuItemRow[];
  variants: VariantRow[]; switches: SwitchRow[]; stores: StoreRow[]; channels: ChannelRow[];
  users: MemoryShopper[]; uploads: Map<string, Upload>;
};

const uuid = (group: string, n: number) => `${group}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const SAMPLE = {
  dining: uuid('a', 1), mart: uuid('a', 2),
  diningOutlet: uuid('b', 1), martOutlet: uuid('b', 2),
};
// Development tokens stand for these platform admins (admin.ts, memory mode only).
export const DEV_ROLES = ['master_admin', 'growth_admin', 'sales_manager', 'sales_executive', 'business_development', 'onboarding_admin', 'customer_success', 'operations'] as const;
export const devAdminId = (role: string) => uuid('e', DEV_ROLES.indexOf(role as (typeof DEV_ROLES)[number]) + 1);

function seed(): MemoryMarket {
  const at = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const org = SAMPLE.dining;
  const cats: [string, string][] = [[uuid('c', 1), 'Biriyani'], [uuid('c', 2), 'Breads'], [uuid('c', 3), 'Desserts']];
  const item = (n: number, category: number, name: string, price: number, is_available = true): MenuItemRow =>
    ({ id: uuid('d', n), organization_id: org, category_id: cats[category][0], name, price, image_url: null, is_available, sort_order: n });
  return {
    organizations: [
      { id: SAMPLE.dining, name: 'Mysore Dining Hall', slug: 'mysore-dining-hall' },
      { id: SAMPLE.mart, name: 'Latur Fresh Mart', slug: 'latur-fresh-mart' },
    ],
    locations: [
      { id: SAMPLE.diningOutlet, organization_id: SAMPLE.dining, name: 'Main outlet', city: 'Latur', address: 'Station Road, Latur 413512', code: 'MAIN' },
      { id: SAMPLE.martOutlet, organization_id: SAMPLE.mart, name: 'Ausa Road', city: 'Latur', address: 'Ausa Road, Latur 413512', code: 'AUSA' },
    ],
    categories: cats.map(([id, name], i) => ({ id, organization_id: org, name, sort_order: i })),
    items: [
      item(1, 0, 'Chicken Biriyani', 185), item(2, 0, 'Veg Biriyani', 149), item(3, 1, 'Parota', 59),
      item(4, 2, 'Gulab Jamun', 79), item(5, 0, 'Mutton Biriyani', 235, false),
    ],
    variants: [
      { id: uuid('f', 1), organization_id: org, menu_item_id: uuid('d', 1), name: 'Half', price: 185, is_default: true, sort_order: 0 },
      { id: uuid('f', 2), organization_id: org, menu_item_id: uuid('d', 1), name: 'Full', price: 269, is_default: false, sort_order: 1 },
    ],
    switches: [], stores: [], channels: [],
    users: [
      { id: uuid('9', 1), email: 'asha.shopper@example.com', phone: '919800000001', created_at: at(20), last_sign_in_at: at(1), banned_until: null },
      { id: uuid('9', 2), email: 'ravi.shopper@example.com', phone: '919800000002', created_at: at(10), last_sign_in_at: at(3), banned_until: null },
      { id: uuid('9', 3), email: null, phone: '919800000003', created_at: at(2), last_sign_in_at: null, banned_until: null },
      ...DEV_ROLES.map((role, i) => ({ id: devAdminId(role), email: `${role.replace(/_/g, '.')}@dev.local`, phone: null, created_at: at(30 + i), last_sign_in_at: at(0), banned_until: null, platform_role: role })),
    ],
    uploads: new Map(),
  };
}

const g = globalThis as unknown as { __onecityMarket?: MemoryMarket };
export const memory = (): MemoryMarket => (g.__onecityMarket ??= seed());
export const resetMemory = () => { g.__onecityMarket = seed(); };

// ---------- Database reads ----------
// PostgREST returns at most 1000 rows per request, so lists that can grow are read page by page.
type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>;
const MISSING_TABLE = ['PGRST205', '42P01'];

export async function selectAll<T>(page: (from: number, to: number) => Page<T>, optional = false): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) {
      if (optional && MISSING_TABLE.includes(error.code ?? '')) return [];
      fromDbError(error);
    }
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

// Migration 0028 adds the listing columns. Until it is applied the listing endpoints answer 503
// instead of failing on a missing column. Looked for again once a minute until they appear.
export const LISTING_COLUMNS = 'status, location_id, cover_image, lat, lng, delivery_radius_km, approved_by, approved_at, updated_at';
let columns: { ready: boolean; at: number } | null = null;

export async function listingColumnsReady(): Promise<boolean> {
  if (!dbConfigured()) return true;
  if (columns && (columns.ready || Date.now() - columns.at < 60_000)) return columns.ready;
  const { error } = await db().from('ol_stores').select(LISTING_COLUMNS).limit(1);
  // PostgREST answers 42703 (Postgres undefined_column) when a column does not exist.
  if (error && !['42703', 'PGRST204'].includes(error.code ?? '')) fromDbError(error);
  columns = { ready: !error, at: Date.now() };
  return !error;
}

const forOrgs = <T extends { organization_id: string }>(rows: T[], ids: string[]) => rows.filter(r => ids.includes(r.organization_id));
const unique = (ids: (string | null | undefined)[]) => [...new Set(ids)].filter((x): x is string => !!x);

export async function readItemMaster(organizationIds: (string | null)[]): Promise<ItemMaster> {
  const ids = unique(organizationIds);
  if (!ids.length) return EMPTY_ITEM_MASTER;
  if (!dbConfigured()) {
    const m = memory();
    return {
      organizations: m.organizations.filter(o => ids.includes(o.id)), categories: forOrgs(m.categories, ids),
      items: forOrgs(m.items, ids), variants: forOrgs(m.variants, ids), switches: forOrgs(m.switches, ids),
    };
  }
  const [organizations, categories, items, variants, switches] = await Promise.all([
    selectAll<OrgRow>((a, b) => db().from('organizations').select('id, name, slug').in('id', ids).order('id').range(a, b)),
    selectAll<MenuCategoryRow>((a, b) => db().from('menu_categories').select('id, organization_id, name, sort_order').in('organization_id', ids).order('id').range(a, b)),
    selectAll<MenuItemRow>((a, b) => db().from('menu_items').select('id, organization_id, category_id, name, price, image_url, is_available, sort_order').in('organization_id', ids).order('id').range(a, b)),
    // Variants are optional: an item without variant rows is sold at its own price.
    selectAll<VariantRow>((a, b) => db().from('pos_menu_item_variants').select('id, organization_id, menu_item_id, name, price, is_default, sort_order').in('organization_id', ids).order('id').range(a, b), true),
    selectAll<SwitchRow>((a, b) => db().from('item_channel_status').select('menu_item_id, organization_id, is_available, off_until').in('organization_id', ids).eq('channel', 'one_local').order('menu_item_id').range(a, b), true),
  ]);
  return { organizations, categories, items, variants, switches };
}

export async function readOrganizations(): Promise<OrgRow[]> {
  if (!dbConfigured()) return memory().organizations;
  return selectAll<OrgRow>((a, b) => db().from('organizations').select('id, name, slug').order('id').range(a, b));
}

export async function readLocations(organizationIds: (string | null)[]): Promise<LocationRow[]> {
  const ids = unique(organizationIds);
  if (!ids.length) return [];
  if (!dbConfigured()) return forOrgs(memory().locations, ids);
  // The live table has no `city` column and `address` is jsonb: the area is `locations.area` (text), the address is an object.
  const rows = await selectAll<Record<string, any>>((a, b) => db().from('locations').select('id, organization_id, name, area, address, code').in('organization_id', ids).order('id').range(a, b), true);
  return rows.map(r => ({ id: r.id, organization_id: r.organization_id, name: r.name, code: r.code ?? null, city: r.area ?? cleanText(r.address?.city), address: addressText(r.address) }));
}

const cleanText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
// `locations.address` is jsonb ({} when unset). A plain string is kept; an object is joined from its usual parts.
function addressText(a: unknown): string | null {
  if (typeof a === 'string') return cleanText(a);
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  const whole = cleanText(o.text) ?? cleanText(o.formatted) ?? cleanText(o.full);
  if (whole) return whole;
  const parts = [o.line1, o.line2, o.street, o.locality, o.city, o.state, o.pincode ?? o.postal_code].map(cleanText).filter((x): x is string => !!x);
  return parts.length ? parts.join(', ') : null;
}

// Listings: Master-created store rows (organization set, not demo); soft-deleted ones left out.
export async function readListingRows(filter: { id?: string; organizationIds?: string[] } = {}): Promise<StoreRow[]> {
  let rows: StoreRow[];
  if (!dbConfigured()) {
    rows = memory().stores.map(r => ({ ...r })); // copies, as a database read would return
  } else if (filter.organizationIds && !filter.organizationIds.length) {
    rows = [];
  } else {
    rows = await selectAll<StoreRow>((a, b) => {
      let q = db().from('ol_stores').select('*').not('organization_id', 'is', null).eq('is_demo', false);
      if (filter.id) q = q.eq('id', filter.id);
      if (filter.organizationIds) q = q.in('organization_id', filter.organizationIds);
      return q.order('id').range(a, b);
    });
  }
  return rows
    .filter(r => isListing(r) && !r.deleted_at && (!filter.id || r.id === filter.id) && (!filter.organizationIds || filter.organizationIds.includes(r.organization_id!)))
    .sort((x, y) => (x.created_at ?? '').localeCompare(y.created_at ?? '') || x.id.localeCompare(y.id));
}

export async function readChannels(organizationIds: (string | null)[]): Promise<ChannelRow[]> {
  const ids = unique(organizationIds);
  if (!ids.length) return [];
  if (!dbConfigured()) return forOrgs(memory().channels, ids);
  return selectAll<ChannelRow>((a, b) => db().from('ol_merchant_channels').select('organization_id, store_id, accepting, address, lat, lng, city_id').in('organization_id', ids).order('organization_id').range(a, b));
}

// ---------- Listings as the app sees them ----------
// Maps listings and their Item Master into the shapes the app already renders (src/api.ts):
//   * store    — the listing (its cover image goes first in the store's media gallery);
//   * products — one per available item, or one per variant ("Chicken Biriyani · Half"), priced
//                from the POS, with the listing as store_id and the organization as brand;
//   * categories — the organizations' menu categories, merged by name within a department, so
//                "Starters" from two restaurants is one Food category;
//   * brands   — one per organization; its id is the organization's first listing's id, so the
//                app's "Store profile" link on a brand page opens that store.
// Product ids are "<listing id>_<menu item id>" (+ "_<variant id>"): unique per store, and the POS
// item stays readable from the id when orders are sent to the restaurant.
export type CatalogStore = {
  id: string; name: string; logo: string; tagline: string; delivery_time: string; rating: number; tags: string[];
  department: string; media: unknown[]; city_id: string;
};
export type CatalogProduct = {
  id: string; name: string; weight: string; price: number; mrp: number; image: string; category_id: string; store_id: string;
  delivery_min: number; discount_pct: number | null; rating: number; department: string; brand_id: string; city_id: string;
};
export type CatalogCategory = { id: string; name: string; emoji: string; color: string; department: string; image: string };
export type CatalogBrand = { id: string; name: string; department: string; logo: string; image: string; tagline: string; city_id: string };
export type ListingCatalog = { stores: CatalogStore[]; products: CatalogProduct[]; categories: CatalogCategory[]; brands: CatalogBrand[] };

const COLORS = ['pastelGreen', 'pastelYellow', 'pastelRed', 'pastelBlue', 'pastelOrange', 'pastelPurple', 'pastelPink', 'pastelMint'];
const hash = (text: string) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const minutes = (text: string | null) => num(text?.match(/\d+/)?.[0], 30);

export function storeOf(row: StoreRow): CatalogStore {
  const cover = row.cover_image ? [{ type: 'image', url: row.cover_image, thumbnail: null, video_web: null }] : [];
  return {
    id: row.id, name: row.name, logo: row.logo ?? '', tagline: row.tagline ?? '', delivery_time: row.delivery_time ?? '',
    rating: num(row.rating, 4.5), tags: row.tags ?? [], department: row.department ?? 'shops',
    media: [...cover, ...(Array.isArray(row.media) ? row.media : [])], city_id: row.city_id,
  };
}

export function listingCatalog(listings: StoreRow[], im: ItemMaster, now = Date.now()): ListingCatalog {
  const orgs = new Map(im.organizations.map(o => [o.id, o]));
  const switches = new Map(im.switches.map(s => [s.menu_item_id, s]));
  const menuCategories = new Map(im.categories.map(c => [c.id, c]));
  const variants = variantsByItem(im);
  const ordered = [...listings].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id));
  const primary = new Map<string, StoreRow>();
  for (const l of ordered) if (!primary.has(l.organization_id!)) primary.set(l.organization_id!, l);

  const products: CatalogProduct[] = [];
  const categories = new Map<string, CatalogCategory & { fromItem: boolean }>();
  for (const l of listings) {
    const department = l.department ?? 'shops';
    const brandId = primary.get(l.organization_id!)!.id;
    const categoryOrder = (id: string | null) => (id ? menuCategories.get(id)?.sort_order ?? 1e6 : 1e6);
    const items = im.items
      .filter(i => i.organization_id === l.organization_id && onForOneLocal(i, switches.get(i.id), now))
      .sort((a, b) => categoryOrder(a.category_id) - categoryOrder(b.category_id) || a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    for (const item of items) {
      const categoryName = (item.category_id && menuCategories.get(item.category_id)?.name?.trim()) || 'More';
      const categoryId = `im-${department}-${slugify(categoryName) || 'more'}`;
      const category = categories.get(categoryId) ?? { id: categoryId, name: categoryName, emoji: '', color: COLORS[hash(categoryId) % COLORS.length], department, image: l.cover_image || l.logo || '', fromItem: false };
      if (item.image_url && !category.fromItem) Object.assign(category, { image: item.image_url, fromItem: true });
      const options = optionsOf(item, variants.get(item.id));
      for (const o of options) {
        products.push({
          id: o.variant ? `${l.id}_${item.id}_${o.variant.id}` : `${l.id}_${item.id}`, name: item.name, weight: department === 'food' ? [l.name, o.label].filter(Boolean).join(' · ') : o.label,
          price: o.price, mrp: o.price, image: item.image_url || l.logo || '', category_id: categoryId, store_id: l.id,
          delivery_min: minutes(l.delivery_time), discount_pct: null, rating: num(l.rating, 4.5), department, brand_id: brandId, city_id: l.city_id,
        });
      }
      if (options.length) categories.set(categoryId, category);
    }
  }
  const brands = [...primary.values()].map(l => ({
    id: l.id, name: orgs.get(l.organization_id!)?.name ?? l.name, department: l.department ?? 'shops',
    logo: l.logo ?? '', image: l.cover_image || l.logo || '', tagline: l.tagline ?? '', city_id: l.city_id,
  }));
  return {
    stores: listings.map(storeOf), products,
    categories: [...categories.values()].map(({ fromItem, ...c }) => c), brands,
  };
}
