import { limit, json, readBody, route } from '../../../server/http';
import { requireRider, setAvailability } from '../../../server/rider';

export const POST = route(async request => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-availability', 10, 60_000);
  return json(await setAvailability(rider, await readBody(request)));
});
