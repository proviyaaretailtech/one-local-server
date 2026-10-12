// What One Local offers at a place. Three levels, the way District scopes India:
//   live      — we deliver: the full catalogue, cart and checkout (inside an ol_service_areas circle)
//   discover  — anywhere else in India: real local restaurants, shops and pharmacies to find,
//               call and visit (listings from OpenStreetMap, see nearby.ts), no ordering yet
//   soon      — outside India
// Live cities are rows in ol_service_areas, so opening a city is data, not an app release.
import { SERVICE_AREAS } from './catalog';
import { db, dbConfigured } from './db';
import { distanceKm, nearestPlace, type IndiaPlace } from './geo';

export type Level = 'live' | 'discover' | 'soon';
export type ServiceId = 'food' | 'grocery' | 'shops' | 'care' | 'book-it';
type Area = { city: string; name: string; lat: number; lng: number; radiusKm: number };

// Services a live city delivers, and what a discover-only place still gets.
const LIVE_SERVICES: ServiceId[] = ['food', 'grocery', 'shops', 'care', 'book-it'];
const DISCOVER_SERVICES: ServiceId[] = ['food', 'grocery', 'shops', 'care'];

let areas: { rows: Area[]; at: number } | null = null;
async function liveAreas(): Promise<Area[]> {
  if (!dbConfigured()) return SERVICE_AREAS;
  if (areas && Date.now() - areas.at < 60_000) return areas.rows;
  const { data, error } = await db().from('ol_service_areas').select('city_id,name,lat,lng,radius_km').eq('active', true);
  if (error || !data?.length) return areas?.rows ?? SERVICE_AREAS;
  const rows = data.map(r => ({ city: r.city_id as string, name: r.name as string, lat: Number(r.lat), lng: Number(r.lng), radiusKm: Number(r.radius_km) }));
  areas = { rows, at: Date.now() };
  return rows;
}

const INDIA = { south: 6.5, north: 37.2, west: 68.0, east: 97.5 };
const inIndia = (p: { lat: number; lng: number }) => p.lat >= INDIA.south && p.lat <= INDIA.north && p.lng >= INDIA.west && p.lng <= INDIA.east;

export type Coverage = {
  level: Level;
  city: string | null;                       // live city id (send as ?city= / x-city), when live
  place: (IndiaPlace & { distance_km: number }) | null;
  nearest_live: { city: string; name: string; distance_km: number };
  services: { id: ServiceId; level: Level }[];
};

export async function coverage(point: { lat: number; lng: number }): Promise<Coverage> {
  const list = await liveAreas();
  const [nearest] = list.map(a => ({ a, km: distanceKm(point, a) })).sort((x, y) => x.km - y.km);
  const live = nearest.km <= nearest.a.radiusKm;
  const india = inIndia(point);
  let place: Coverage['place'] = null;
  if (india) { try { place = nearestPlace(point); } catch { place = null; } }
  const level: Level = live ? 'live' : india ? 'discover' : 'soon';
  const services = LIVE_SERVICES.map(id => ({
    id, level: (level === 'live' ? 'live' : level === 'discover' && DISCOVER_SERVICES.includes(id) ? 'discover' : 'soon') as Level,
  }));
  return {
    level, city: live ? nearest.a.city : null, place, services,
    nearest_live: { city: nearest.a.city, name: nearest.a.name, distance_km: Math.round(nearest.km * 10) / 10 },
  };
}
