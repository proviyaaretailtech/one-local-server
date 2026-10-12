// Real local places for "discover" towns (where we don't deliver yet): restaurants, grocers,
// shops and pharmacies, each with distance, a phone number to call and directions.
//
// Two sources behind one shape, so the app never changes when the source does:
//   Google Places (New)  — used automatically once GOOGLE_MAPS_API_KEY is set (the founder's
//                          chosen maps provider). Google's terms don't allow keeping its place
//                          data, so answers are only shared between identical requests in flight.
//   OpenStreetMap        — until then: the public Overpass API, one query per area for all four
//                          kinds, one query at a time, kept for hours (ODbL; the app shows the credit).
// NEARBY_SOURCE=osm|google overrides the choice (for demos and cost control).
// The search area fits the place: a couple of km in a metro, wider around towns, and 15 → 30 km
// around a village, so the page is never empty.
import { distanceKm, nearestPlace } from './geo';
import { HttpError } from './http';

export type NearbyKind = 'food' | 'grocery' | 'shops' | 'care';
export type NearbyPlace = {
  id: string; name: string; type: string; lat: number; lng: number; distance_km: number;
  address: string | null;
  phone: string | null;          // dialable, +91…; null when the listed number isn't a valid Indian number
  phone_display: string | null;  // "+91 98765 43210"
  cuisine: string | null; hours: string | null; open_now: boolean | null;
  rating: number | null; rating_count: number | null; website: string | null;
  directions_url: string;        // Google Maps directions to this place (free link, no key)
};
export type NearbySource = 'Google' | 'OpenStreetMap';
export type NearbyResult = { radius_km: number; groups: Record<NearbyKind, NearbyPlace[]>; source: NearbySource };

const KINDS: NearbyKind[] = ['food', 'grocery', 'shops', 'care'];
const PER_KIND = 40;

// Search radii by how built-up the place is.
function radiiFor(point: { lat: number; lng: number }): number[] {
  try {
    const p = nearestPlace(point);
    if (p.population >= 1_000_000) return [2_000, 5_000];
    if (p.kind === 'city' || p.kind === 'locality' || p.population >= 100_000) return [4_000, 12_000];
    if (p.kind === 'town') return [8_000, 25_000];
  } catch { /* outside the place list: treat as rural */ }
  return [15_000, 30_000];
}

// ---------- Phone numbers ----------
// Listings carry numbers in every shape ("02382 245678", "+91-98765-43210; 98…", "9876543210").
// Keep the first one, make it dialable as +91 plus 10 digits, and drop anything that isn't.
export function indianPhone(raw: string | null | undefined): { phone: string; display: string } | null {
  const first = raw?.split(/[;,/]/)[0]?.trim();
  if (!first) return null;
  let digits = first.replace(/[^\d+]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('0091')) digits = digits.slice(4);
  else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  if (!/^[1-9]\d{9}$/.test(digits)) return null;
  const mobile = /^[6-9]/.test(digits);
  return { phone: `+91${digits}`, display: mobile ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : `+91 ${digits}` };
}

const directions = (lat: number, lng: number, placeId?: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}${placeId ? `&destination_place_id=${encodeURIComponent(placeId)}` : ''}`;
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.round(distanceKm(a, b) * 10) / 10;

// ---------- Google Places (New) ----------
const GOOGLE_TYPES: Record<NearbyKind, string[]> = {
  food: ['restaurant', 'cafe', 'bakery', 'fast_food_restaurant', 'meal_takeaway', 'ice_cream_shop', 'sweets_and_desserts_shop'],
  grocery: ['grocery_store', 'supermarket', 'convenience_store', 'market'],
  shops: ['clothing_store', 'shoe_store', 'electronics_store', 'cell_phone_store', 'jewelry_store', 'book_store', 'furniture_store', 'hardware_store', 'department_store', 'shopping_mall', 'gift_shop', 'sporting_goods_store'],
  care: ['pharmacy', 'drugstore', 'hospital', 'doctor', 'dentist', 'beauty_salon', 'hair_salon'],
};
const GOOGLE_FIELDS = ['id', 'displayName', 'location', 'primaryTypeDisplayName', 'shortFormattedAddress', 'nationalPhoneNumber',
  'internationalPhoneNumber', 'regularOpeningHours.openNow', 'rating', 'userRatingCount', 'websiteUri'].map(f => `places.${f}`).join(',');

type GooglePlace = {
  id: string; displayName?: { text: string }; location?: { latitude: number; longitude: number }; primaryTypeDisplayName?: { text: string };
  shortFormattedAddress?: string; nationalPhoneNumber?: string; internationalPhoneNumber?: string; regularOpeningHours?: { openNow?: boolean };
  rating?: number; userRatingCount?: number; websiteUri?: string;
};

async function googleKind(kind: NearbyKind, at: { lat: number; lng: number }, radius: number, key: string): Promise<NearbyPlace[]> {
  const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_FIELDS },
    body: JSON.stringify({
      includedTypes: GOOGLE_TYPES[kind], maxResultCount: 20, rankPreference: 'DISTANCE', languageCode: 'en', regionCode: 'IN',
      locationRestriction: { circle: { center: { latitude: at.lat, longitude: at.lng }, radius: Math.min(radius, 50_000) } },
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { places?: GooglePlace[]; error?: { status?: string } };
  if (!response.ok) { console.warn('[nearby] google', response.status, body.error?.status); throw new Error(`google ${response.status}`); }
  return (body.places ?? []).flatMap(p => {
    if (!p.location || !p.displayName?.text) return [];
    const lat = p.location.latitude, lng = p.location.longitude, phone = indianPhone(p.internationalPhoneNumber ?? p.nationalPhoneNumber);
    return [{
      id: `g-${p.id}`, name: p.displayName.text, type: (p.primaryTypeDisplayName?.text ?? kind).toLowerCase(), lat, lng, distance_km: km(at, { lat, lng }),
      address: p.shortFormattedAddress ?? null, phone: phone?.phone ?? null, phone_display: phone?.display ?? null, cuisine: null, hours: null,
      open_now: p.regularOpeningHours?.openNow ?? null, rating: p.rating ?? null, rating_count: p.userRatingCount ?? null,
      website: p.websiteUri ?? null, directions_url: directions(lat, lng, p.id),
    }];
  });
}

async function searchGoogle(at: { lat: number; lng: number }, key: string): Promise<NearbyResult> {
  // Google ranks by distance, so one search per kind at the wider radius finds the nearest 20.
  const radius = radiiFor(at)[1];
  const lists = await Promise.allSettled(KINDS.map(k => googleKind(k, at, radius, key)));
  if (lists.every(l => l.status === 'rejected')) throw new HttpError(502, 'Local listings are unavailable right now. Please try again.');
  const groups = Object.fromEntries(KINDS.map((k, i) => [k, lists[i].status === 'fulfilled' ? lists[i].value : []])) as Record<NearbyKind, NearbyPlace[]>;
  return { radius_km: radius / 1000, groups, source: 'Google' };
}

// ---------- OpenStreetMap (Overpass) ----------
const TAGS: Record<NearbyKind, { amenity?: string[]; shop?: string[] }> = {
  food: { amenity: ['restaurant', 'cafe', 'fast_food', 'food_court', 'ice_cream'], shop: ['bakery', 'confectionery', 'sweets'] },
  grocery: { shop: ['supermarket', 'convenience', 'greengrocer', 'grocery', 'dairy', 'butcher', 'general', 'frozen_food'] },
  shops: { shop: ['clothes', 'shoes', 'electronics', 'mobile_phone', 'jewelry', 'books', 'gift', 'hardware', 'furniture', 'department_store', 'mall', 'sports', 'optician', 'bag', 'boutique', 'stationery', 'toys', 'variety_store'] },
  care: { amenity: ['pharmacy', 'clinic', 'hospital', 'doctors', 'dentist'], shop: ['chemist', 'beauty', 'cosmetics', 'hairdresser'] },
};
// Any other named shop (tailor, kirana with an odd tag, puja items…) still counts as a shop.
const kindOf = (t: Record<string, string>): NearbyKind | null =>
  KINDS.find(k => (t.amenity && TAGS[k].amenity?.includes(t.amenity)) || (t.shop && TAGS[k].shop?.includes(t.shop))) ?? (t.shop ? 'shops' : null);
const AMENITIES = KINDS.flatMap(k => TAGS[k].amenity ?? []).join('|');
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const OSM_TTL_MS = 6 * 3_600_000;

type Element = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
const g = globalThis as unknown as { __onecityNearby?: Map<string, { at: number; value: Promise<NearbyResult> }>; __onecityOverpass?: Promise<unknown> };
const cache = (g.__onecityNearby ??= new Map());

// One Overpass request at a time from this server.
function queued<T>(task: () => Promise<T>): Promise<T> {
  const run = (g.__onecityOverpass ?? Promise.resolve()).catch(() => {}).then(task);
  g.__onecityOverpass = run.catch(() => {});
  return run;
}

async function overpass(query: string): Promise<Element[]> {
  let last: unknown;
  for (const url of ENDPOINTS) {
    try {
      // Overpass requires a User-Agent (406 without one).
      const response = await fetch(`${url}?data=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(28_000), headers: { 'User-Agent': 'OneLocal/1.0 (city marketplace app)' },
      });
      if (!response.ok) throw new Error(`overpass ${response.status}`);
      // An overloaded server can answer with an XML "remark" instead of JSON.
      const body = (await response.json().catch(() => null)) as { elements?: Element[] } | null;
      if (!body) throw new Error('overpass returned no JSON');
      return body.elements ?? [];
    } catch (e) { last = e; }
  }
  console.warn('[nearby]', last);
  throw new HttpError(502, 'Local listings are unavailable right now. Please try again.');
}

const label = (t: Record<string, string>) => (t.amenity ?? t.shop ?? 'place').replace(/_/g, ' ');
const address = (t: Record<string, string>) => {
  const parts = [t['addr:housenumber'], t['addr:street'], t['addr:suburb'] ?? t['addr:neighbourhood'], t['addr:city']].filter(Boolean);
  return parts.length ? parts.join(', ') : t['addr:full'] ?? null;
};
const latin = (s?: string) => !!s && /^[\x20-\x7e]+$/.test(s);

async function searchOsm(at: { lat: number; lng: number }): Promise<NearbyResult> {
  let result: NearbyResult | null = null;
  for (const radius of radiiFor(at)) {
    // A bounding box and "any shop" are cheap for Overpass; a long list of shop types or a
    // circle times out (504) on the public server. Types and the circle are applied here instead.
    const dLat = radius / 111_000, dLng = radius / (111_000 * Math.cos((at.lat * Math.PI) / 180));
    const box = `(${(at.lat - dLat).toFixed(4)},${(at.lng - dLng).toFixed(4)},${(at.lat + dLat).toFixed(4)},${(at.lng + dLng).toFixed(4)})`;
    let elements: Element[];
    try {
      elements = await queued(() => overpass(
        `[out:json][timeout:25];(nwr["shop"]["name"]${box};nwr["amenity"~"^(${AMENITIES})$"]["name"]${box};);out center 1500;`,
      ));
    } catch (e) {
      if (result) break; // the wider search failed: the nearer, smaller answer is still useful
      throw e;
    }
    const groups = Object.fromEntries(KINDS.map(k => [k, [] as NearbyPlace[]])) as Record<NearbyKind, NearbyPlace[]>;
    for (const e of elements) {
      const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon, t = e.tags ?? {}, kind = kindOf(t);
      if (lat == null || lng == null || !t.name || !kind) continue;
      if (distanceKm(at, { lat, lng }) > radius / 1000) continue;
      const phone = indianPhone(t.phone ?? t['contact:phone'] ?? t['contact:mobile']);
      groups[kind].push({
        id: `osm-${e.type[0]}${e.id}`, name: latin(t['name:en']) ? t['name:en'] : t.name, type: label(t), lat, lng, distance_km: km(at, { lat, lng }),
        address: address(t), phone: phone?.phone ?? null, phone_display: phone?.display ?? null, cuisine: t.cuisine?.replace(/[;_]/g, ' ') ?? null,
        hours: t.opening_hours ?? null, open_now: null, rating: null, rating_count: null,
        website: t.website ?? t['contact:website'] ?? null, directions_url: directions(lat, lng),
      });
    }
    for (const k of KINDS) groups[k] = groups[k].sort((a, b) => a.distance_km - b.distance_km).slice(0, PER_KIND);
    result = { radius_km: radius / 1000, groups, source: 'OpenStreetMap' };
    // Widen only when the place is nearly empty.
    if (KINDS.reduce((n, k) => n + groups[k].length, 0) >= 12) break;
  }
  return result!;
}

// ---------- Entry point ----------
export function nearbySource(): NearbySource {
  const forced = process.env.NEARBY_SOURCE?.trim().toLowerCase();
  if (forced === 'osm') return 'OpenStreetMap';
  return process.env.GOOGLE_MAPS_API_KEY?.trim() && forced !== 'osm' ? 'Google' : 'OpenStreetMap';
}

export function nearby(point: { lat: number; lng: number }): Promise<NearbyResult> {
  // ~1 km grid, so neighbours share one answer.
  const at = { lat: Math.round(point.lat * 100) / 100, lng: Math.round(point.lng * 100) / 100 };
  const source = nearbySource();
  const key = `${source}:${at.lat}:${at.lng}`;
  const hit = cache.get(key);
  const ttl = source === 'Google' ? 0 : OSM_TTL_MS;
  if (hit && (Date.now() - hit.at < ttl || source === 'Google')) return hit.value;
  const value = source === 'Google' ? searchGoogle(at, process.env.GOOGLE_MAPS_API_KEY!.trim()) : searchOsm(at);
  cache.set(key, { at: Date.now(), value });
  // Google answers are shared only while the request is in flight; failures are never kept.
  value.then(() => { if (source === 'Google') cache.delete(key); }, () => cache.delete(key));
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return value;
}
