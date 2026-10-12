import { json, route } from '../../../server/http';
import { limitCaller } from '../../../server/limits';
import { placeDetails } from '../../../server/maps';

export const GET = route(async (request, { id }) => {
  await limitCaller(request, 'place', 30, 60_000, { verify: false });
  return json(await placeDetails(id, new URL(request.url).searchParams.get('session')));
});
