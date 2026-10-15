// Restaurant pickup location (specs/restaurant-pickup-location, database migration 0341).
// The restaurant's owner or a manager sets and confirms the exact point riders pick up from. The database function
// ol_set_pickup_location is the guarantee (role, organization status, service area, accuracy, request key, history, and the copy in
// ol_merchant_channels that checkout and dispatch read); this file checks the same things first so the app gets plain answers.
// Address search, reverse lookup and the map image run here with the server's Google key; the app never holds a maps key.
import { db, fromDbError, rpc } from './db';
import { distanceKm } from './geo';
import { HttpError } from './http';
import { mapsConfigured, reverseGeocode, searchText, staticMap } from './maps';
import { can, Staff } from './partner';

type Row = Record<string, any>;
export type PickupStatus = 'missing' | 'unverified' | 'verified' | 'disputed';
const PARTNER_SOURCES = ['geocoder', 'map_pin', 'merchant_edit'] as const;

// A database without migration 0341 (the hosted project before its SQL is run) has no such table: read as "no canonical point".
export const missingTable = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === '42P01' || error.code === 'PGRST205' || (/ol_merchant_location/.test(error.message ?? '') && /does not exist|could not find/i.test(error.message ?? '')));

let toldMissing = false;
function noteMissing() {
  if (!toldMissing) { toldMissing = true; console.warn('[pickup] table ol_merchant_locations is missing: run migration 0341 (docs/online-migrations/ONELOCAL_PICKUP_LOCATION_2026-10-14.sql).'); }
}

// How strict a city is (ol_service_areas.pickup_enforcement, migration 0344): 'verified' = only confirmed points take orders,
// 'coordinates' = any point (rollout). A database without the column is treated as 'verified'.
export async function pickupEnforcement(cityId: string | null | undefined): Promise<'verified' | 'coordinates'> {
  if (!cityId) return 'verified';
  const { data, error } = await db().from('ol_service_areas').select('pickup_enforcement').eq('city_id', cityId).maybeSingle();
  if (error) {
    if (!/pickup_enforcement/.test(error.message ?? '')) fromDbError(error);
    return 'verified';
  }
  return data?.pickup_enforcement === 'coordinates' ? 'coordinates' : 'verified';
}

/** missing | unverified | verified | disputed, or null when the database has no pickup table yet. */
export async function pickupStatus(organizationId: string): Promise<PickupStatus | null> {
  const { data, error } = await db().from('ol_merchant_locations').select('verification_status').eq('organization_id', organizationId).maybeSingle();
  if (missingTable(error)) { noteMissing(); return null; }
  if (error) fromDbError(error);
  return data ? (data.verification_status as PickupStatus) : 'missing';
}

async function area(cityId: string | null) {
  if (!cityId) return null;
  const { data, error } = await db().from('ol_service_areas').select('city_id, name, lat, lng, radius_km, active').eq('city_id', cityId).is('deleted_at', null).maybeSingle();
  if (error) fromDbError(error);
  return data && data.active ? { id: data.city_id as string, name: data.name as string, lat: Number(data.lat), lng: Number(data.lng), radius_km: Number(data.radius_km) } : null;
}

async function channelCity(staff: Staff): Promise<{ set_up: boolean; city_id: string | null }> {
  const { data, error } = await db().from('ol_merchant_channels').select('city_id').eq('organization_id', staff.organizationId).maybeSingle();
  if (error) fromDbError(error);
  return { set_up: !!data, city_id: (data?.city_id as string) ?? null };
}

export async function getPickupLocation(staff: Staff) {
  const channel = await channelCity(staff);
  const [{ data: loc, error }, { data: history, error: historyError }, city] = await Promise.all([
    db().from('ol_merchant_locations').select('*').eq('organization_id', staff.organizationId).maybeSingle(),
    db().from('ol_merchant_location_history').select('change, source, actor_user_id, after, created_at').eq('organization_id', staff.organizationId).order('id', { ascending: false }).limit(10),
    area(channel.city_id),
  ]);
  if (missingTable(error)) { noteMissing(); throw new HttpError(503, 'Pickup locations are not switched on yet.', undefined, 'not_configured'); }
  if (error) fromDbError(error);
  if (historyError) fromDbError(historyError);
  const maps = mapsConfigured();
  return {
    organization_id: staff.organizationId,
    status: (loc ? loc.verification_status : 'missing') as PickupStatus,
    location: loc ? {
      lat: Number(loc.lat), lng: Number(loc.lng), formatted_address: loc.formatted_address, place_id: loc.place_id, source: loc.source,
      verification_status: loc.verification_status, accuracy_m: loc.accuracy_m == null ? null : Number(loc.accuracy_m),
      verified_at: loc.verified_at, verified_by_me: !!loc.verified_by && loc.verified_by === staff.userId, version: loc.version, updated_at: loc.updated_at,
    } : null,
    set_up: channel.set_up,
    city,
    can_edit: can(staff, 'location'),
    maps: { search: maps, map: maps },
    history: (history ?? []).map((h: Row) => ({
      change: h.change, source: h.source, at: h.created_at, by_me: h.actor_user_id === staff.userId,
      after: h.after ? { lat: h.after.lat, lng: h.after.lng, formatted_address: h.after.formatted_address, verification_status: h.after.verification_status } : null,
    })),
  };
}

const capitalise = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

function num(value: unknown, what: string, min: number, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${what} is not valid.`, undefined, 'invalid_request');
  return n;
}

function text(value: unknown, what: string, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new HttpError(400, `${what} is not valid.`, undefined, 'invalid_request');
  const t = value.trim();
  if (t.length > max) throw new HttpError(400, `${what} is too long (${max} characters at most).`, undefined, 'invalid_request');
  return t || null;
}

export function parsePickupBody(body: Row) {
  const lat = num(body.lat, 'Latitude', -90, 90), lng = num(body.lng, 'Longitude', -180, 180);
  if (lat === 0 && lng === 0) throw new HttpError(400, 'A valid map position is needed.', undefined, 'invalid_request');
  const source = String(body.source ?? '');
  if (!(PARTNER_SOURCES as readonly string[]).includes(source)) throw new HttpError(400, 'Say how the position was found.', undefined, 'invalid_request');
  const accuracy = body.accuracy_m == null ? null : num(body.accuracy_m, 'Accuracy', 0, 100000);
  if (body.confirm != null && typeof body.confirm !== 'boolean') throw new HttpError(400, 'Say whether you confirm this position.', undefined, 'invalid_request');
  const version = body.version == null ? null : num(body.version, 'The version', 0, 1_000_000_000);
  return {
    lat, lng, source, accuracy_m: accuracy, confirm: body.confirm !== false, version: version == null ? null : Math.trunc(version),
    formatted_address: text(body.formatted_address, 'The address', 300), place_id: text(body.place_id, 'The place reference', 300),
  };
}

export async function setPickupLocation(staff: Staff, body: Row, requestKey: string | null) {
  if (!can(staff, 'location')) throw new HttpError(403, 'Only the owner or a manager can change the pickup location.', undefined, 'forbidden');
  const p = parsePickupBody(body);
  // Friendly answers first; the database checks all of these again.
  const channel = await channelCity(staff);
  if (!channel.set_up) throw new HttpError(404, 'This restaurant is not set up on One Local yet.', undefined, 'not_on_one_local');
  const city = await area(channel.city_id);
  if (!city) throw new HttpError(422, 'One Local does not deliver in this city yet.', undefined, 'outside_delivery_area');
  if (distanceKm(p, city) > city.radius_km) throw new HttpError(422, `This point is outside the One Local delivery area for ${city.name}.`, undefined, 'outside_delivery_area');
  if (p.confirm && p.accuracy_m == null && p.source !== 'map_pin') {
    throw new HttpError(422, 'Say how precise this position is, or move the pin onto your shop entrance.', undefined, 'accuracy_too_low');
  }
  if (p.confirm && p.accuracy_m != null && p.accuracy_m > 100) {
    throw new HttpError(422, `This position is only accurate to about ${Math.round(p.accuracy_m)} m. Move the pin onto your shop entrance, or stand at the entrance and try again.`, undefined, 'accuracy_too_low');
  }
  let out: Row;
  try {
    out = await rpc<Row>('ol_set_pickup_location', {
      p_org: staff.organizationId, p_actor: staff.userId, p_lat: p.lat, p_lng: p.lng, p_address: p.formatted_address, p_place_id: p.place_id,
      p_source: p.source, p_accuracy_m: p.accuracy_m, p_confirm: p.confirm, p_request_key: requestKey, p_expected_version: p.version,
    });
  } catch (error) {
    if (error instanceof HttpError) error.detail = capitalise(error.detail);
    throw error;
  }
  return { ...(await getPickupLocation(staff)), changed: !!out?.changed, replayed: !!out?.replayed };
}

async function cityFor(staff: Staff) {
  const city = await area((await channelCity(staff)).city_id);
  if (!city) throw new HttpError(404, 'This restaurant is not set up on One Local yet.', undefined, 'not_on_one_local');
  return city;
}

export async function searchPickup(staff: Staff, query: string) {
  const q = query.trim();
  if (q.length < 2 || q.length > 120) throw new HttpError(400, 'Type between 2 and 120 characters.', undefined, 'invalid_request');
  const city = await cityFor(staff);
  const hits = await searchText(q, city, city.radius_km * 1000 * 2);
  return { results: hits.map(h => ({ ...h, serviceable: distanceKm(h, city) <= city.radius_km })) };
}

export async function reversePickup(staff: Staff, lat: number, lng: number) {
  const city = await cityFor(staff);
  const place = await reverseGeocode(lat, lng);
  return { formatted_address: place.formatted, serviceable: distanceKm({ lat, lng }, city) <= city.radius_km };
}

export async function pickupMap(lat: number, lng: number, zoom: number, w: number, h: number) {
  const image = await staticMap(lat, lng, zoom, w, h);
  return new Response(image, { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' } });
}
