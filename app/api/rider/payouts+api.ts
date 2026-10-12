import { json, limit, route } from '../../../server/http';
import { requireRider } from '../../../server/rider';
import { listPayouts } from '../../../server/rider-money';

export const GET = route(async (request, params) => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-read', 120, 60000);
  return json(await listPayouts(rider, new URL(request.url).searchParams.get('cursor')));
});
