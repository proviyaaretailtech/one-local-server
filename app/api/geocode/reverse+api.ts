import { json, route } from '../../../server/http';
import { limitCaller } from '../../../server/limits';
import { parsePoint, reverseGeocode } from '../../../server/maps';

export const GET = route(async request => {
  await limitCaller(request, 'geocode', 30, 60_000, { verify: false });
  const point = parsePoint(new URL(request.url), true)!;
  return json(await reverseGeocode(point.lat, point.lng));
});
