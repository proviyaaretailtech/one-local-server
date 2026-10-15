// Google Maps Platform, called only from the server so the key never ships in the app.
// Uses Places API (New) for search and place details, and the Geocoding API for pin → address.
import { SERVICE_AREAS, serviceability } from './catalog';
import { HttpError, redact } from './http';

const KEY = () => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new HttpError(503, 'Maps are not set up yet. Please add your address details by hand.', undefined, 'maps_unavailable');
  return key;
};

export type Place = {
  lat: number; lng: number; formatted: string; locality: string; city: string; state: string; pincode: string;
  serviceable: boolean; service_city: string | null; nearest_city: string; distance_km: number;
};

type Component = { types: string[]; long_name?: string; longText?: string };

function describe(lat: number, lng: number, formatted: string, components: Component[]): Place {
  const pick = (...types: string[]) => {
    for (const type of types) {
      const c = components.find(x => x.types.includes(type));
      if (c) return c.long_name ?? c.longText ?? '';
    }
    return '';
  };
  const city = pick('locality', 'administrative_area_level_3', 'administrative_area_level_2');
  const locality = pick('sublocality_level_1', 'sublocality', 'neighborhood', 'route') || city;
  const s = serviceability({ lat, lng });
  return {
    lat, lng, formatted, locality, city, state: pick('administrative_area_level_1'), pincode: pick('postal_code'),
    serviceable: s.serviceable, service_city: s.city, nearest_city: s.nearest_city, distance_km: s.distance_km,
  };
}

async function google(url: string, init: RequestInit = {}) {
  // The geocoding address carries the key in its query, so nothing from a failed call (the error, the reply) is logged unmasked.
  let response: Response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) }); }
  catch (error) {
    console.warn('[maps] request failed:', redact((error as Error)?.name ?? 'error'));
    throw new HttpError(502, 'Map search is unavailable right now. Please try again.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.warn('[maps]', response.status, redact(JSON.stringify(body).slice(0, 300)));
    throw new HttpError(502, 'Map search is unavailable right now. Please try again.');
  }
  return body;
}

export async function autocomplete(input: string, near: { lat: number; lng: number } | null, sessionToken: string | null) {
  const bias = near ?? SERVICE_AREAS[0];
  const body = await google('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY() },
    body: JSON.stringify({
      input, includedRegionCodes: ['in'], languageCode: 'en', ...(sessionToken ? { sessionToken } : {}),
      locationBias: { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 30000 } },
    }),
  });
  return ((body.suggestions ?? []) as { placePrediction?: { placeId: string; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } }; text?: { text: string } } }[])
    .map(s => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .slice(0, 8)
    .map(p => ({ place_id: p.placeId, title: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '', subtitle: p.structuredFormat?.secondaryText?.text ?? '' }));
}

export async function placeDetails(placeId: string, sessionToken: string | null): Promise<Place> {
  if (!/^[\w-]{10,300}$/.test(placeId)) throw new HttpError(400, 'Unknown place');
  const query = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : '';
  const body = await google(`https://places.googleapis.com/v1/places/${placeId}${query}`, {
    headers: { 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': 'formattedAddress,location,addressComponents' },
  });
  if (!body.location) throw new HttpError(404, 'That place has no map position');
  return describe(body.location.latitude, body.location.longitude, body.formattedAddress ?? '', (body.addressComponents ?? []).map((c: { types: string[]; longText: string }) => ({ types: c.types, longText: c.longText })));
}

export async function reverseGeocode(lat: number, lng: number): Promise<Place> {
  const body = await google(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=en&region=in&key=${KEY()}`);
  if (body.status === 'ZERO_RESULTS' || !body.results?.length) {
    return describe(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`, []);
  }
  if (body.status !== 'OK') {
    console.warn('[maps] geocode status', body.status, redact(String(body.error_message ?? '')));
    throw new HttpError(502, 'Could not find this address right now. Please try again.');
  }
  const best = body.results[0];
  return describe(lat, lng, best.formatted_address, best.address_components ?? []);
}

export function parsePoint(url: URL, required: boolean): { lat: number; lng: number } | null {
  const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
  const ok = url.searchParams.has('lat') && url.searchParams.has('lng') && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && Number.isFinite(lat) && Number.isFinite(lng);
  if (!ok && required) throw new HttpError(400, 'A map position is needed');
  return ok ? { lat, lng } : null;
}

export const mapsConfigured = () => !!process.env.GOOGLE_MAPS_API_KEY;

// How precise a search result is, in metres, from what kind of place it is: a shop or a street address is a point, a road is a
// line, a neighbourhood or a city is an area. Used to decide whether the result alone may be confirmed as a pickup point.
const AREA_TYPES = ['locality', 'sublocality', 'sublocality_level_1', 'sublocality_level_2', 'neighborhood', 'postal_code', 'political',
  'administrative_area_level_1', 'administrative_area_level_2', 'administrative_area_level_3', 'country', 'colloquial_area'];
export function accuracyForTypes(types: string[]): number {
  if (types.some(t => ['establishment', 'point_of_interest', 'premise', 'subpremise', 'street_address'].includes(t))) return 25;
  if (types.includes('route')) return 100;
  if (types.some(t => AREA_TYPES.includes(t))) return 1000;
  return 25; // a business type alone ('restaurant', 'store') is a point
}

export type SearchHit = { place_id: string; title: string; subtitle: string; lat: number; lng: number; accuracy_m: number };

// Places Text Search (New): one call finds shops and addresses with their positions ("Demo Spice Gandhi Chowk").
export async function searchText(query: string, near: { lat: number; lng: number }, radiusM = 30000): Promise<SearchHit[]> {
  const body = await google('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types' },
    body: JSON.stringify({
      textQuery: query, regionCode: 'in', languageCode: 'en', maxResultCount: 8,
      locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: Math.min(50000, radiusM) } },
    }),
  });
  return ((body.places ?? []) as { id: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude: number; longitude: number }; types?: string[] }[])
    .filter(p => p.location && Number.isFinite(p.location.latitude) && Number.isFinite(p.location.longitude))
    .slice(0, 8)
    .map(p => ({
      place_id: p.id, title: p.displayName?.text ?? p.formattedAddress ?? '', subtitle: p.formattedAddress ?? '',
      lat: p.location!.latitude, lng: p.location!.longitude, accuracy_m: accuracyForTypes(p.types ?? []),
    }));
}

// A road map image centred on a point, for the partner app's pickup pin (the app draws the pin; nothing is marked on the image).
// scale=2 gives a sharp image on phone screens; the app still works in the logical w x h size.
export async function staticMap(lat: number, lng: number, zoom: number, w: number, h: number): Promise<ArrayBuffer> {
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${w}x${h}&scale=2&maptype=roadmap&language=en&region=in&key=${KEY()}`;
  let response: Response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(8000) }); }
  catch (error) {
    console.warn('[maps] static map failed:', redact((error as Error)?.name ?? 'error'));
    throw new HttpError(502, 'The map is unavailable right now. Please try again.', undefined, 'maps_unavailable');
  }
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.startsWith('image/')) {
    const text = await response.text().catch(() => '');
    console.warn('[maps] static map', response.status, redact(text.slice(0, 200)));
    throw new HttpError(502, 'The map is unavailable right now. Please try again.', undefined, 'maps_unavailable');
  }
  return response.arrayBuffer();
}
