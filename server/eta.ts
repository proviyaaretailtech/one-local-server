// Delivery time for a customer at a given point: what the kitchen needs to prepare + a short handover + the ride from the
// store to the customer. It replaces the fixed "10/15/30 min" a store was listed with, whenever the store's own map position and
// prep time are known (ol_merchant_channels, set by the merchant). A store without them is simply left out: the app then keeps
// the time the store was listed with. Without a database there is nothing to compute.
import { distanceKm } from './catalog';
import { db, dbConfigured } from './db';

export const DEFAULT_PREP_MIN = 15;
export const HANDOVER_MIN = 3;
export const TRAVEL_MIN_PER_KM = 3; // a bike through town, about 20 km/h
export const MIN_ETA = 10;
export const MAX_ETA = 90;

/** Minutes to the customer: prep + handover + travel, rounded up and kept between 10 and 90. */
export function etaMinutes(prepMin: number | null | undefined, km: number): number {
  const prep = prepMin && prepMin > 0 ? prepMin : DEFAULT_PREP_MIN;
  return Math.min(MAX_ETA, Math.max(MIN_ETA, Math.ceil(prep + HANDOVER_MIN + Math.max(0, km) * TRAVEL_MIN_PER_KM)));
}

type Origin = { id: string; lat: number; lng: number; prep: number | null };
let cache: { at: number; origins: Origin[] } | null = null;
const TTL_MS = 60_000;

async function origins(): Promise<Origin[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.origins;
  const [stores, channels] = await Promise.all([
    db().from('ol_stores').select('id, organization_id').not('organization_id', 'is', null).is('deleted_at', null),
    db().from('ol_merchant_channels').select('organization_id, lat, lng, default_prep_minutes, accepting'),
  ]);
  if (stores.error || channels.error) throw new Error((stores.error ?? channels.error)!.message);
  const byOrg = new Map((channels.data ?? []).filter(c => c.accepting && c.lat != null && c.lng != null).map(c => [c.organization_id as string, c]));
  const list: Origin[] = [];
  for (const s of stores.data ?? []) {
    const c = byOrg.get(s.organization_id as string);
    if (c) list.push({ id: s.id as string, lat: Number(c.lat), lng: Number(c.lng), prep: c.default_prep_minutes == null ? null : Number(c.default_prep_minutes) });
  }
  cache = { at: Date.now(), origins: list };
  return list;
}

/** store id -> minutes, for the stores that are accepting orders and have a map position. */
export async function storeEtas(point: { lat: number; lng: number }): Promise<Record<string, number>> {
  if (!dbConfigured()) return {};
  const out: Record<string, number> = {};
  for (const o of await origins()) out[o.id] = etaMinutes(o.prep, distanceKm(point, o));
  return out;
}
