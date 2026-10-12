// Pure map geometry for live navigation and tracking (specs/live-navigation-eta). No network, no database, no clock:
// everything here is a function of its arguments, so it is checked on its own (scripts/live-tracking-checks.ts).
//
// A route is a Google "encoded polyline" (precision 5: 1e-5 degrees, about 1 m). Progress along a route is worked out by projecting
// the rider's position onto that polyline, which is what lets one Google call serve many position updates.

export type LatLng = { lat: number; lng: number };

const EARTH_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

// Great-circle distance in metres.
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------- Google encoded polyline ----------
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const out: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  const next = (): number | null => {
    let result = 0, shift = 0, byte: number;
    do {
      if (index >= encoded.length) return null; // a cut-off string ends the line instead of reading garbage
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = next(), dLng = next();
    if (dLat === null || dLng === null) break;
    lat += dLat; lng += dLng;
    out.push({ lat: lat / factor, lng: lng / factor });
  }
  return out;
}

export function encodePolyline(points: LatLng[], precision = 5): string {
  const factor = 10 ** precision;
  let out = '', lastLat = 0, lastLng = 0;
  const put = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    out += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * factor), lng = Math.round(p.lng * factor);
    put(lat - lastLat); put(lng - lastLng);
    lastLat = lat; lastLng = lng;
  }
  return out;
}

// ---------- A polyline as a measured line ----------
// Distance along the line at each vertex: cumulative[i] is the length from the first point to point i.
export function cumulativeM(points: LatLng[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + haversineM(points[i - 1], points[i]));
  return out;
}

export const polylineLengthM = (points: LatLng[]): number => cumulativeM(points)[points.length - 1] ?? 0;

export type Projection = {
  index: number;    // the segment (points[index] to points[index + 1]) the position projects onto
  point: LatLng;    // the nearest point on the line
  alongM: number;   // distance from the start of the line to that point
  offsetM: number;  // how far the position is from the line (0 = on it)
};

// The nearest point on the line to `p`. Each segment is treated as flat (an equirectangular patch around the position): the error is
// well under a metre for the few hundred metres between two route vertices. null when the line has no points at all.
export function projectOnPolyline(points: LatLng[], p: LatLng, cumulative: number[] = cumulativeM(points)): Projection | null {
  if (!points.length) return null;
  if (points.length === 1) return { index: 0, point: points[0], alongM: 0, offsetM: haversineM(points[0], p) };
  const cosLat = Math.cos(rad(p.lat));
  const mx = (lng: number) => rad(lng - p.lng) * cosLat * EARTH_M;
  const my = (lat: number) => rad(lat - p.lat) * EARTH_M;
  let best: { index: number; t: number; d2: number } | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const ax = mx(points[i].lng), ay = my(points[i].lat), bx = mx(points[i + 1].lng), by = my(points[i + 1].lat);
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (-ax * dx + -ay * dy) / len2)); // the position is the origin of this patch
    const qx = ax + t * dx, qy = ay + t * dy, d2 = qx * qx + qy * qy;
    if (!best || d2 < best.d2) best = { index: i, t, d2 };
  }
  const { index, t, d2 } = best!;
  const a = points[index], b = points[index + 1];
  const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  return { index, point, alongM: cumulative[index] + (cumulative[index + 1] - cumulative[index]) * t, offsetM: Math.sqrt(d2) };
}

export const remainingAlongM = (totalM: number, projection: Projection): number => Math.max(0, totalM - projection.alongM);

export const isOffRoute = (projection: Projection | null, thresholdM: number): boolean => !projection || projection.offsetM > thresholdM;

// The part of the line still ahead of the projected position, starting at that position (what a map draws once the rider has moved).
export function trimAhead(points: LatLng[], projection: Projection): LatLng[] {
  if (points.length < 2) return points.slice();
  const ahead = points.slice(projection.index + 1);
  const last = ahead[0];
  // A position exactly on the next vertex would repeat that vertex.
  return last && last.lat === projection.point.lat && last.lng === projection.point.lng ? ahead : [projection.point, ...ahead];
}
