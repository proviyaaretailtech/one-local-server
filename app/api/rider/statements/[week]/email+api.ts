import { json, limit, route } from '../../../../../server/http';
import { requireRider } from '../../../../../server/rider';
import { emailStatement } from '../../../../../server/rider-statements';

export const POST = route(async (request, params) => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-statement-email', 5, 3_600_000);
  return json(await emailStatement(rider, params?.week ?? ''));
});
