import { json, route } from '../../server/http';
import { limitCaller } from '../../server/limits';
import { parsePoint } from '../../server/maps';
import { nearby } from '../../server/nearby';

// Real local places around a point (food, grocery, shops, care), for towns we don't deliver to yet.
export const GET = route(async request => {
  await limitCaller(request, 'nearby', 20, 60_000, { verify: false });
  return json(await nearby(parsePoint(new URL(request.url), true)!));
});
