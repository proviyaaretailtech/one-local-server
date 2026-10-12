import { json, limit, route } from '../../../../../server/http';
import { acceptOffer, requireRider } from '../../../../../server/rider';

export const POST = route(async (request, params) => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-answer', 20, 60_000);
  return json(await acceptOffer(rider, params?.id ?? ''));
});
