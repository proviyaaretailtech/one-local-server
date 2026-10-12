import { json, limit, readBody, route } from '../../../../../../server/http';
import { requireRider } from '../../../../../../server/rider';
import { resolveWait, idemKey } from '../../../../../../server/rider-extra';

export const POST = route(async (request, params) => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-command', 60, 60000);
  return json(await resolveWait(rider, params?.id ?? '', await readBody(request), idemKey(request, false)));
});
