import { json, limit, route } from '../../../../../server/http';
import { requireRider } from '../../../../../server/rider';
import { callCustomer } from '../../../../../server/rider-extra';

export const POST = route(async (request, params) => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-call', 20, 60000);
  return json(await callCustomer(rider, params?.id ?? ''));
});
