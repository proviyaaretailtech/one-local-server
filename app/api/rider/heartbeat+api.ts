import { limit, json, readBody, route } from '../../../server/http';
import { heartbeat, requireRider } from '../../../server/rider';

export const POST = route(async request => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-heartbeat', 12, 60_000);
  return json(await heartbeat(rider, await readBody(request)));
});
