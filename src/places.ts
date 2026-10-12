// Address search and map positions for the location flow. All Google calls go through our
// own API (app/api/places, app/api/geocode) so the Maps key never ships in the app.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { apiGet, apiPost } from './api';
import { consentGranted } from './privacy';
import { t } from './i18n';
import type { Point } from './delivery-location';
import type { Address } from './customer';

export const CITY_CENTER: Point = { lat: 18.4088, lng: 76.5604 }; // Latur

export type Suggestion = { place_id: string; title: string; subtitle: string };
export type Place = Point & {
  formatted: string; locality: string; city: string; state: string; pincode: string;
  serviceable: boolean; service_city: string | null; nearest_city: string; distance_km: number;
};

const near = (p?: Point | null) => (p ? `&lat=${p.lat}&lng=${p.lng}` : '');

export const searchPlaces = (q: string, session: string, around?: Point | null) =>
  apiGet<Suggestion[]>(`/places/autocomplete?q=${encodeURIComponent(q)}&session=${session}${near(around)}`);
export const placeDetails = (id: string, session: string) => apiGet<Place>(`/places/${encodeURIComponent(id)}?session=${session}`);
export const reverseGeocode = (p: Point) => apiGet<Place>(`/geocode/reverse?lat=${p.lat}&lng=${p.lng}`);
export const checkServiceable = (p: Point) =>
  apiGet<{ serviceable: boolean; city: string | null; nearest_city: string; distance_km: number }>(`/serviceability?lat=${p.lat}&lng=${p.lng}`);

// Location refused. After a "Don't Allow" the phone never asks again (canAskAgain false), so the
// screen offers a way to Settings instead of a button that silently does nothing.
// The message is translated when the error is created (never at module load), so it is already in the
// person's language: screens show `.message` for these two errors and use useErrorMessage() for the rest.
export class LocationOffError extends Error {
  constructor(public canAskAgain: boolean) {
    super(canAskAgain ? t('location.off.canAsk') : t('location.off.settings'));
  }
}
export class LocationUnavailableError extends Error {
  constructor() { super(t('location.cannotFind')); }
}
/** True for the location errors above, whose message is already a translated sentence. */
export const isLocationError = (e: unknown): e is LocationOffError | LocationUnavailableError =>
  e instanceof LocationOffError || e instanceof LocationUnavailableError;

// A fresh fix can take long indoors (or never come on a simulator), so wait at most 12 s, then
// fall back to a recent known position, and say so plainly if there is none.
export async function currentPoint(): Promise<Point> {
  const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new LocationOffError(canAskAgain);
  const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
  const late = new Promise<null>(resolve => setTimeout(() => resolve(null), 12_000));
  const pos = (await Promise.race([fresh, late]))
    ?? (await Location.getLastKnownPositionAsync({ maxAge: 30 * 60_000 }).catch(() => null));
  if (!pos) throw new LocationUnavailableError();
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

// Only if the customer already allowed location: never prompts. Reading it without being asked is
// the optional "location for nearby suggestions" purpose, so it also needs that consent (off until
// switched on in Privacy & your data). Tapping "Use current location" (currentPoint) always works.
export async function knownPoint(): Promise<Point | null> {
  try {
    if (!(await consentGranted('location_suggestions'))) return null;
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getLastKnownPositionAsync();
    return pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : null;
  } catch {
    return null;
  }
}

// True for "18.39124, 76.56176": what the server sends as the address when Google knows no street at the pin.
export const isCoordinateText = (s: string) => /^\s*-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/.test(s);

export function distanceKm(a: Point, b: Point) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// ---------- All of India (our own place list: free, no Google call) ----------
export type IndiaPlace = Point & {
  id: string; name: string; kind: 'city' | 'town' | 'locality' | 'village'; population: number;
  district: string | null; state: string; state_code: string; district_code: string | null; distance_km?: number | null;
};
export const placeLine = (p: Pick<IndiaPlace, 'district' | 'state' | 'name'>) => [p.district && p.district !== p.name ? p.district : null, p.state].filter(Boolean).join(', ');
export const searchIndia = (q: string, around?: Point | null) => apiGet<IndiaPlace[]>(`/india/search?q=${encodeURIComponent(q)}${near(around)}`);
export const popularCities = () => apiGet<IndiaPlace[]>('/india/popular');
export const listStates = () => apiGet<{ code: string; name: string }[]>('/india/states');
export const listDistricts = (state: string) => apiGet<{ code: string; name: string }[]>(`/india/states/${state}`);
export const listPlaces = (state: string, district: string) => apiGet<IndiaPlace[]>(`/india/states/${state}/${district}`);

// What One Local offers at a point: live (we deliver), discover (local listings only), soon.
export type Level = 'live' | 'discover' | 'soon';
export type Coverage = {
  level: Level; city: string | null; place: (IndiaPlace & { distance_km: number }) | null;
  nearest_live: { city: string; name: string; distance_km: number };
  services: { id: string; level: Level }[];
};
export const coverageAt = (p: Point) => apiGet<Coverage>(`/coverage?lat=${p.lat}&lng=${p.lng}`);

export type NearbyKind = 'food' | 'grocery' | 'shops' | 'care';
export type NearbyPlace = Point & {
  id: string; name: string; type: string; distance_km: number; address: string | null; phone: string | null; phone_display: string | null;
  cuisine: string | null; hours: string | null; open_now: boolean | null; rating: number | null; rating_count: number | null;
  website: string | null; directions_url: string;
};
export type Nearby = { radius_km: number; groups: Record<NearbyKind, NearbyPlace[]>; source: 'Google' | 'OpenStreetMap' };
export const nearbyAt = (p: Point) => apiGet<Nearby>(`/nearby?lat=${p.lat}&lng=${p.lng}`);
export const requestLaunch = (placeId: string) => apiPost<{ id: string; place: string }>('/launch-requests', { place_id: placeId });

// ---------- Recent searches (this device) ----------
export type Recent = Point & { title: string; subtitle: string };
const RECENT_KEY = 'onecity.recent-places.v1';

export async function recentPlaces(): Promise<Recent[]> {
  try { return JSON.parse((await AsyncStorage.getItem(RECENT_KEY)) || '[]'); } catch { return []; }
}

export async function rememberPlace(place: Recent) {
  const list = (await recentPlaces()).filter(r => r.title !== place.title || r.subtitle !== place.subtitle);
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify([place, ...list].slice(0, 5))).catch(() => {});
}

// How an address reads in the header and when it is the selected delivery location.
export const addressText = (a: Address) => `${a.label}: ${[a.line, a.locality || a.area].filter(Boolean).join(', ')}${a.pin ? ` ${a.pin}` : ''}`;
