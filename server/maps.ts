// Google Maps Platform, called only from the server so the key never ships in the app.
// Uses Places API (New) for search and place details, and the Geocoding API for pin → address.
import { SERVICE_AREAS, serviceability } from './catalog';
import { HttpError, redact } from './http';

const KEY = () => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new HttpError(503, 'Maps are not set up yet. Please add your address details by hand.');
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
