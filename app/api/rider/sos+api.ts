import { json, limit, readBody, route } from '../../../server/http';
import { requireRider } from '../../../server/rider';
import { raiseSos, idemKey } from '../../../server/rider-extra';

export const POST = route(async (request, params) => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-sos', 10, 60000);
  return json(await raiseSos(rider, await readBody(request), idemKey(request, false)));
});
