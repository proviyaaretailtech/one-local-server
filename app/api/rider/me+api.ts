import { json, limit, route } from '../../../server/http';
import { requireRider } from '../../../server/rider';
import { getMe } from '../../../server/riderMe';

export const GET = route(async request => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-me', 60, 60_000);
  return json(await getMe(rider));
});
