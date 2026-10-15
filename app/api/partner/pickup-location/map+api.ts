// A road map image centred on the pickup pin (Google Static Maps, server key). The partner app pans it by dragging and draws the
// pin itself, so the app needs no maps key and no native map that could crash without one.
import { limitCaller } from '../../../../server/limits';
import { parsePoint } from '../../../../server/maps';
import { requirePartnerAuth } from '../../../../server/partner';
import { pickupMap } from '../../../../server/pickup-location';
import { HttpError, route } from '../../../../server/http';

const whole = (url: URL, name: string, min: number, max: number, fallback: number) => {
  const raw = url.searchParams.get(name);
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be a whole number from ${min} to ${max}.`, undefined, 'invalid_request');
  return n;
};

export const GET = route(async request => {
  await requirePartnerAuth(request);
  const url = new URL(request.url);
  const point = parsePoint(url, true)!;
  const zoom = whole(url, 'zoom', 12, 20, 17), w = whole(url, 'w', 200, 640, 400), h = whole(url, 'h', 200, 640, 400);
  await limitCaller(request, 'pickup-map', 60, 60_000);
  return pickupMap(point.lat, point.lng, zoom, w, h);
});
