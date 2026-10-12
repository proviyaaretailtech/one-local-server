// Every populated place in India — cities, towns, city localities and villages — so a customer
// anywhere can pick where they are. Built from GeoNames by scripts/build-india-places.py and
// loaded once per server process (about 470,000 rows, a second to load).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import admin from './data/india-admin.json';
import { HttpError } from './http';

export type PlaceKind = 'city' | 'town' | 'locality' | 'village';
export type IndiaPlace = {
  id: string; name: string; lat: number; lng: number; kind: PlaceKind; population: number;
  district: string | null; state: string; state_code: string; district_code: string | null;
};

const KINDS: Record<string, PlaceKind> = { c: 'city', t: 'town', l: 'locality', v: 'village' };
const KIND_WEIGHT: Record<PlaceKind, number> = { city: 4, town: 2.5, locality: 2, village: 0 };
const STATES = admin.states as Record<string, string>;
const DISTRICTS = admin.districts as Record<string, string>;

type Index = {
  names: string[]; lat: Float32Array; lng: Float32Array; pop: Int32Array; kind: string[]; a1: string[]; a2: string[];
  keys: { key: string; i: number }[]; byId: Map<string, number>;
};
let index: Index | null = null;

export const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const slug = (s: string) => normalize(s).replace(/ /g, '-');
const idOf = (ix: Index, i: number) => `in-${ix.a1[i]}-${ix.a2[i] || '0'}-${slug(ix.names[i])}`;

function load(): Index {
  if (index) return index;
  const file = path.resolve(process.cwd(), 'server/data/india-places.tsv.gz');
  if (!fs.existsSync(file)) throw new HttpError(503, 'Place search is not available right now.');
  const lines = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n').filter(Boolean);
  const n = lines.length;
  const ix: Index = { names: new Array(n), lat: new Float32Array(n), lng: new Float32Array(n), pop: new Int32Array(n), kind: new Array(n), a1: new Array(n), a2: new Array(n), keys: [], byId: new Map() };
  for (let i = 0; i < n; i++) {
    const [name, lat, lng, a1, a2, pop, kind, aliases] = lines[i].split('\t');
    ix.names[i] = name; ix.lat[i] = +lat; ix.lng[i] = +lng; ix.a1[i] = a1; ix.a2[i] = a2; ix.pop[i] = +pop; ix.kind[i] = kind;
    const own = normalize(name);
    ix.keys.push({ key: own, i });
    // Multi-word names are also found by a later word ("Sambhaji" → Chhatrapati Sambhaji Nagar).
    if (kind !== 'v') for (const w of own.split(' ').slice(1)) if (w.length > 2) ix.keys.push({ key: w, i });
    if (aliases) for (const a of aliases.split('|')) {
      const key = normalize(a);
      ix.keys.push({ key, i });
      for (const w of key.split(' ').slice(1)) if (w.length > 3) ix.keys.push({ key: w, i });
    }
  }
  ix.keys.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  for (let i = 0; i < n; i++) ix.byId.set(idOf(ix, i), i);
  return (index = ix);
}

function place(ix: Index, i: number): IndiaPlace {
  const a2 = ix.a2[i] || null;
  return {
    id: idOf(ix, i), name: ix.names[i], lat: Math.round(ix.lat[i] * 1e4) / 1e4, lng: Math.round(ix.lng[i] * 1e4) / 1e4,
    kind: KINDS[ix.kind[i]], population: ix.pop[i], state_code: ix.a1[i], district_code: a2,
    state: STATES[ix.a1[i]] ?? 'India', district: a2 ? DISTRICTS[`${ix.a1[i]}.${a2}`] ?? null : null,
  };
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// First key >= prefix.
function lowerBound(keys: Index['keys'], prefix: string) {
  let lo = 0, hi = keys.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (keys[mid].key < prefix) lo = mid + 1; else hi = mid; }
  return lo;
}

// Prefix search over names and old names. Bigger places and places near the customer rank first;
// an exact name beats a longer one ("Latur" before "Latur Road").
export function searchIndia(query: string, near: { lat: number; lng: number } | null, limit = 12): (IndiaPlace & { distance_km: number | null })[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const ix = load();
  const seen = new Map<number, number>();
  for (let k = lowerBound(ix.keys, q); k < ix.keys.length && ix.keys[k].key.startsWith(q) && seen.size < 4000; k++) {
    const { key, i } = ix.keys[k];
    const kind = KINDS[ix.kind[i]];
    let score = KIND_WEIGHT[kind] + Math.log10(ix.pop[i] + 1) * 0.6 + (key === q ? 3 : 0) - (key.length - q.length) * 0.02;
    if (near) score += Math.max(0, 4 - Math.log10(distanceKm(near, { lat: ix.lat[i], lng: ix.lng[i] }) + 1) * 1.6);
    if ((seen.get(i) ?? -Infinity) < score) seen.set(i, score);
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([i]) => {
    const p = place(ix, i);
    return { ...p, distance_km: near ? Math.round(distanceKm(near, p) * 10) / 10 : null };
  });
}

export function placeById(id: string): IndiaPlace {
  const ix = load();
  const i = ix.byId.get(id);
  if (i === undefined) throw new HttpError(404, 'We could not find that place');
  return place(ix, i);
}

// The named place a map position belongs to: the nearest town or city within a few km, else the
// nearest village, so a pin in a field still reads "Killari, Latur".
export function nearestPlace(point: { lat: number; lng: number }): IndiaPlace & { distance_km: number } {
  const ix = load();
  let bestTown = -1, bestTownKm = Infinity, bestAny = -1, bestAnyKm = Infinity;
  const box = 0.5; // degrees; ~55 km
  for (let i = 0; i < ix.names.length; i++) {
    if (Math.abs(ix.lat[i] - point.lat) > box || Math.abs(ix.lng[i] - point.lng) > box) continue;
    const km = distanceKm(point, { lat: ix.lat[i], lng: ix.lng[i] });
    if (km < bestAnyKm) { bestAny = i; bestAnyKm = km; }
    // A city's pull reaches further than a town's.
    const reach = ix.kind[i] === 'c' ? 12 : ix.kind[i] === 't' || ix.kind[i] === 'l' ? 4 : 0;
    if (reach && km <= reach && km / reach < bestTownKm) { bestTown = i; bestTownKm = km / reach; }
  }
  const i = bestTown >= 0 ? bestTown : bestAny;
  if (i < 0) throw new HttpError(404, 'This spot is outside India');
  return { ...place(ix, i), distance_km: Math.round(distanceKm(point, { lat: ix.lat[i], lng: ix.lng[i] }) * 10) / 10 };
}

// ---------- Browsing: state → district → places ----------
export function listStates() {
  return Object.entries(STATES).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function listDistricts(state: string) {
  if (!STATES[state]) throw new HttpError(404, 'Unknown state');
  return Object.entries(DISTRICTS).filter(([k]) => k.startsWith(`${state}.`))
    .map(([k, name]) => ({ code: k.split('.')[1], name })).sort((a, b) => a.name.localeCompare(b.name));
}

// Cities and towns first (largest first), then every village A–Z.
export function listPlaces(state: string, district: string) {
  if (!DISTRICTS[`${state}.${district}`]) throw new HttpError(404, 'Unknown district');
  const ix = load();
  const rows: IndiaPlace[] = [];
  for (let i = 0; i < ix.names.length; i++) if (ix.a1[i] === state && ix.a2[i] === district) rows.push(place(ix, i));
  const rank = (p: IndiaPlace) => (p.kind === 'village' ? 1 : 0);
  return rows.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? b.population - a.population : a.name.localeCompare(b.name)));
}

// The picker's city tiles, in the founder's order (27 Sep 2026: metros first).
const POPULAR = ['Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad', 'Jaipur'];
export function popularCities() {
  const ix = load();
  return POPULAR.map(name => {
    let best = -1;
    for (let k = lowerBound(ix.keys, normalize(name)); k < ix.keys.length && ix.keys[k].key === normalize(name); k++) {
      const i = ix.keys[k].i;
      if (best < 0 || ix.pop[i] > ix.pop[best]) best = i;
    }
    return best >= 0 ? place(ix, best) : null;
  }).filter((p): p is IndiaPlace => !!p);
}
