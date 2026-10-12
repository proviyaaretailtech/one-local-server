// Read side of the One Latur catalogue, from two sources merged into one:
//   1. Marketplace listings the Master approved (ol_stores rows with an organization, not demo, status
//      live) selling their organization's own POS items: the Item Master (marketplace.ts). These are
//      the real stores, so they are listed first.
//   2. The ol_* demo catalogue, as before, minus any store row that is paused or soft-deleted. After
//      the founder's clean-up (db/cleanup/) no demo rows are left and only source 1 remains.
// Loaded with the service role (db.ts) and cached in memory for a short TTL so every request doesn't
// hit the database. Without Supabase it is the bundled sample (data/catalog.json) plus the in-memory
// listings, so the app and the Master still run with `npx expo start` and no .env.
import jsonFallback from './data/catalog.json';
import { db, dbConfigured } from './db';
import { HttpError } from './http';
import { isListing, isVisible, ListingCatalog, listingCatalog, memory, readItemMaster, StoreRow } from './marketplace';

export type Product = (typeof jsonFallback.products)[number];
export type Store = (typeof jsonFallback.stores)[number];
export type Coupon = (typeof jsonFallback.coupons)[number];
export type Brand = (typeof jsonFallback.brands)[number];
export type Event = (typeof jsonFallback.events)[number];
type CatalogData = typeof jsonFallback;

// ---------- Loading & cache ----------
const TTL_MS = 30_000;
let cache: { data: CatalogData; at: number } | null = null;
let inFlight: Promise<CatalogData> | null = null;
let generation = 0;

// After an admin change, so this server shows it at once (other servers within TTL_MS).
export function invalidateCatalog() {
  generation++;
  cache = null;
  inFlight = null;
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

async function loadFromDb(): Promise<CatalogData> {
  const client = db();
  const [categories, brands, stores, products, banners, chips, coupons, events, themed, reels] = await Promise.all([
    client.from('ol_categories').select('*').order('sort_order'),
    client.from('ol_brands').select('*').order('name'),
    client.from('ol_stores').select('*').order('sort_order'),
    client.from('ol_products').select('*').eq('is_available', true).order('sort_order'),
    client.from('ol_banners').select('*').order('sort_order'),
    client.from('ol_discover_chips').select('*').order('sort_order'),
    client.from('ol_coupons').select('*').eq('active', true),
    client.from('ol_events').select('*').order('sort_order'),
    client.from('ol_themed_stores').select('*').order('sort_order'),
    client.from('ol_reels').select('*').order('sort_order'),
  ]);
  const first = [categories, brands, stores, products, banners, chips, coupons, events, themed, reels].find(r => r.error);
  if (first?.error) { console.error('[catalog] load failed:', first.error.message); throw new HttpError(503, 'The catalogue is not available right now.'); }

  return withListings({
    categories: (categories.data ?? []).map(c => ({ id: c.id, name: c.name, emoji: c.emoji, color: c.color, department: c.department, image: c.image })),
    discover_chips: (chips.data ?? []).map(c => ({ id: c.id, label: c.label, emoji: c.emoji, color: c.color })),
    banners: (banners.data ?? []).map(b => ({ id: b.id, title: b.title, subtitle: b.subtitle, image: b.image, bg: b.bg, city_id: b.city_id })),
    // store_id (draft migration 0026): a coupon for one store only; absent until that is applied.
    coupons: (coupons.data ?? []).map(c => ({ code: c.code, label: c.label, kind: c.kind, value: num(c.value), min_order: num(c.min_order), description: c.description, city_id: c.city_id, store_id: c.store_id ?? null })),
    stores: (stores.data ?? []).map(s => ({ id: s.id, name: s.name, logo: s.logo, tagline: s.tagline, delivery_time: s.delivery_time, rating: num(s.rating), tags: s.tags ?? [], department: s.department, media: s.media ?? [], city_id: s.city_id })),
    products: (products.data ?? []).map(p => ({
      id: p.id, name: p.name, weight: p.weight, price: num(p.price), mrp: num(p.mrp), image: p.image,
      category_id: p.category_id, store_id: p.store_id, delivery_min: p.delivery_min, discount_pct: p.discount_pct,
      rating: num(p.rating), department: p.department, brand_id: p.brand_id ?? '', city_id: p.city_id,
    })),
    brands: (brands.data ?? []).map(b => ({ id: b.id, name: b.name, department: b.department, logo: b.logo, image: b.image, tagline: b.tagline, city_id: b.city_id })),
    events: (events.data ?? []).map(e => ({ id: e.id, title: e.title, kind: e.kind, subtitle: e.subtitle, venue: e.venue, price: num(e.price), image: e.image, tag: e.tag, slots: e.slots ?? [], city_id: e.city_id })),
    themed_stores: (themed.data ?? []).map(t => t.data),
    reels: (reels.data ?? []).map(r => ({ id: r.id, product_id: r.product_id, brand_id: r.brand_id, video: r.video, caption: r.caption, creator: r.creator, likes: r.likes, tag: r.tag, city_id: r.city_id })),
  } as unknown as CatalogData, (stores.data ?? []) as StoreRow[]);
}

// Merges the live Item-Master listings into a catalogue built from the demo rows. `rows` are all
// ol_stores rows: listing rows and paused or soft-deleted rows are taken out of the demo part (with
// their products), and the live listings are added in front with their organization's items.
async function withListings(base: CatalogData, rows: StoreRow[]): Promise<CatalogData> {
  const live = rows.filter(r => isListing(r) && isVisible(r));
  const hidden = new Set(rows.filter(r => isListing(r) || !isVisible(r)).map(r => r.id));
  if (!live.length && !hidden.size) return base;
  const market: ListingCatalog = live.length
    ? listingCatalog(live, await readItemMaster(live.map(r => r.organization_id)))
    : { stores: [], products: [], categories: [], brands: [] };
  return {
    ...base,
    stores: [...market.stores, ...base.stores.filter(s => !hidden.has(s.id))],
    products: [...market.products, ...base.products.filter(p => !hidden.has(p.store_id))],
    categories: [...market.categories, ...base.categories],
    brands: [...market.brands, ...base.brands],
  } as unknown as CatalogData;
}

export async function getCatalog(): Promise<CatalogData> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  // No database: the sample plus the in-memory listings, worked out on every call (it is small).
  if (!dbConfigured()) return withListings(jsonFallback, memory().stores);
  if (!inFlight) {
    const started = generation;
    const load: Promise<CatalogData> = loadFromDb()
      .then(data => { if (started === generation) cache = { data, at: Date.now() }; return data; })
      .catch(err => { if (cache) return cache.data; throw err; })
      .finally(() => { if (inFlight === load) inFlight = null; });
    inFlight = load;
  }
  return inFlight;
}

// ---------- Locality ----------
// Every listing belongs to one city; viewers only see their own city's listings.
// The sample catalogue is all Latur. A second city is data (city_id on rows), not code.
export const ACTIVE_CITIES: Record<string, string> = { latur: 'Latur, Maharashtra' };

// Where each city delivers: a centre and radius. A starting approximation; move to polygons
// (or pincode lists) once real delivery zones are drawn.
export const SERVICE_AREAS = [
  { city: 'latur', name: 'Latur', lat: 18.4088, lng: 76.5604, radiusKm: 15 },
];

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function serviceability(point: { lat: number; lng: number }) {
  const nearest = SERVICE_AREAS.map(area => ({ area, km: distanceKm(point, area) })).sort((x, y) => x.km - y.km)[0];
  const serviceable = nearest.km <= nearest.area.radiusKm;
  return { serviceable, city: serviceable ? nearest.area.city : null, nearest_city: nearest.area.name, distance_km: Math.round(nearest.km * 10) / 10 };
}

export function resolveCity(request: Request): string {
  const url = new URL(request.url);
  const slug = (url.searchParams.get('city') || request.headers.get('x-city') || 'latur').trim().toLowerCase();
  if (!(slug in ACTIVE_CITIES)) throw new HttpError(404, "We haven't launched in this city yet");
  return slug;
}

const cityOf = (item: object) => (item as { city_id?: string }).city_id || 'latur';
export const inCity = <T extends object>(items: readonly T[], city: string): T[] => items.filter(i => cityOf(i) === city);

// ---------- Products ----------
const INTENTS: Record<string, string[]> = {
  care: ['pharmacy', 'beauty'], 'personal care': ['pharmacy', 'beauty'], 'pharmacy beauty': ['pharmacy', 'beauty'],
  shopping: ['shops'], shops: ['shops'], shop: ['shops'], groceries: ['grocery'], grocery: ['grocery'],
  supermarket: ['grocery'], pharmacy: ['pharmacy'], beauty: ['beauty'], food: ['food'],
};

export type ProductFilters = { category_id?: string | null; chip?: string | null; department?: string | null; brand_id?: string | null; q?: string | null };

export async function filterProducts(city: string, f: ProductFilters): Promise<Product[]> {
  const data = await getCatalog();
  let items = inCity(data.products, city);
  if (f.category_id) items = items.filter(p => p.category_id === f.category_id);
  if (f.department) items = items.filter(p => p.department === f.department || (f.department === 'care' && ['pharmacy', 'beauty'].includes(p.department)));
  if (f.brand_id) items = items.filter(p => p.brand_id === f.brand_id);
  if (f.q) {
    if (f.q.length > 80) throw new HttpError(400, 'Please use a shorter search');
    const query = f.q.toLowerCase().replace(/[&’']/g, ' ').split(/\s+/).filter(Boolean).join(' ');
    if (INTENTS[query]) {
      items = items.filter(p => INTENTS[query].includes(p.department));
    } else {
      const categories = new Map(data.categories.map(c => [c.id, c.name]));
      const brands = new Map(data.brands.map(b => [b.id, b.name]));
      const words = query.split(' ').filter(Boolean);
      items = items.filter(p => {
        const text = `${p.name} ${p.weight} ${categories.get(p.category_id) ?? ''} ${brands.get(p.brand_id ?? '') ?? ''}`.toLowerCase();
        return words.every(w => text.includes(w));
      });
    }
  }
  if (f.chip) {
    switch (f.chip) {
      case 'd1': items = items.filter(p => p.discount_pct); break;
      case 'd2': items = [...items].reverse().slice(0, 6); break;
      case 'd3': case 'd7': items = items.filter(p => p.category_id === 'c1'); break;
      case 'd4': items = items.filter(p => p.rating >= 4.6); break;
      case 'd5': items = items.filter(p => p.price < 99); break;
      case 'd6': items = items.filter(p => ['s1', 's2', 's3'].includes(p.store_id)); break;
      case 'd8': items = items.filter(p => p.weight.toLowerCase().includes('pack') || p.name.toLowerCase().includes('meal')); break;
      default: throw new HttpError(400, 'Unknown discovery filter');
    }
  }
  return items;
}

export async function findProduct(city: string, id: string): Promise<Product | undefined> {
  const data = await getCatalog();
  return inCity(data.products, city).find(p => p.id === id);
}

// ---------- Coupons ----------
export type CouponResult = { ok: boolean; discount: number; coupon: Coupon | null; message: string };

export async function applyCoupon(rawCode: string, subtotal: number): Promise<CouponResult> {
  const data = await getCatalog();
  const code = rawCode.trim().toUpperCase();
  const coupon = data.coupons.find(c => c.code === code);
  if (!coupon) return { ok: false, discount: 0, coupon: null, message: 'Invalid coupon code' };
  if (subtotal < coupon.min_order) return { ok: false, discount: 0, coupon: null, message: `Add ₹${(coupon.min_order - subtotal).toFixed(0)} more to use ${code}` };
  const discount = Math.min(coupon.kind === 'flat' ? coupon.value : Math.round((subtotal * coupon.value) / 100), subtotal);
  return { ok: true, discount, coupon, message: `Coupon ${code} applied!` };
}

// Same rule the cart shows today: free delivery from ₹199, otherwise ₹15.
export const deliveryFee = (subtotal: number) => (subtotal >= 199 || subtotal === 0 ? 0 : 15);

// ---------- Reels ----------
export async function reelsFor(city: string) {
  const data = await getCatalog();
  return inCity(data.reels, city).map(r => ({
    ...r,
    video_web: `${r.video}-webm`,
    product: data.products.find(p => p.id === r.product_id),
    brand: data.brands.find(b => b.id === r.brand_id),
  }));
}
