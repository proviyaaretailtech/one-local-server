// Google "encoded polyline" (precision 5 by default) <-> points. Pure, no imports, so the order screen, the map
// components and the check script (scripts/tracking-ui-checks.ts) all share it.
//
// The server sends `route.polyline` in this format (see specs/live-navigation-eta/spec.md, Route object).
// decodePolyline never throws: a truncated or garbage string gives the points that decoded cleanly (maybe none),
// because a broken line on a map must not take the whole order screen down.

export type LatLng = { lat: number; lng: number };

export function decodePolyline(encoded: unknown, precision = 5): LatLng[] {
  if (typeof encoded !== 'string' || encoded.length === 0) return [];
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  // One signed delta: 5-bit chunks, low bits first, +63 so each is printable, bit 0x20 means "more follows".
  const readDelta = (): number | null => {
    let result = 0, shift = 0, byte: number;
    do {
      if (index >= encoded.length || shift > 30) return null; // truncated, or too long to be a real coordinate
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) return null; // not a polyline character
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = readDelta();
    if (dLat === null) break;
    const dLng = readDelta();
    if (dLng === null) break;
    lat += dLat; lng += dLng;
    points.push({ lat: lat / factor, lng: lng / factor });
  }
  return points;
}

/** The reverse of decodePolyline. Used by the check script and the e2e mock, not by the app itself. */
export function encodePolyline(points: LatLng[], precision = 5): string {
  const factor = 10 ** precision;
  let out = '', prevLat = 0, prevLng = 0;
  const write = (delta: number) => {
    let v = delta < 0 ? ~(delta << 1) : delta << 1;
    while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    out += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * factor), lng = Math.round(p.lng * factor);
    write(lat - prevLat); write(lng - prevLng);
    prevLat = lat; prevLng = lng;
  }
  return out;
}
