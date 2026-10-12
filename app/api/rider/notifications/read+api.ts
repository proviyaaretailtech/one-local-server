import { json, limit, readBody, route } from '../../../../server/http';
import { requireRider } from '../../../../server/rider';
import { markNotificationsRead } from '../../../../server/rider-extra';

export const POST = route(async (request, params) => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-notif-read', 60, 60000);
  return json(await markNotificationsRead(rider, await readBody(request)));
});
