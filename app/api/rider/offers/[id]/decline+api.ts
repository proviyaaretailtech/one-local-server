import { json, limit, readBody, route } from '../../../../../server/http';
import { declineOffer, requireRider } from '../../../../../server/rider';

export const POST = route(async (request, params) => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-answer', 20, 60_000);
  return json(await declineOffer(rider, params?.id ?? '', await readBody(request)));
});
