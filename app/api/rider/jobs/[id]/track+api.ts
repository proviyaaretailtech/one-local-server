import { json, limit, readBody, route } from '../../../../../server/http';
import { requireRider } from '../../../../../server/rider';
import { recordTrack } from '../../../../../server/rider-extra';

export const POST = route(async (request, params) => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-track', 30, 60000);
  return json(await recordTrack(rider, params?.id ?? '', await readBody(request, 32 * 1024)));
});
