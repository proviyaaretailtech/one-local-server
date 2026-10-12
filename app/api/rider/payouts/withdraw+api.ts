import { json, limit, readBody, route } from '../../../../server/http';
import { requireRider } from '../../../../server/rider';
import { withdraw } from '../../../../server/rider-money';
import { idemKey } from '../../../../server/rider-extra';

export const POST = route(async (request, params) => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-money-write', 20, 60000);
  const { body, replayed } = await withdraw(rider, await readBody(request), idemKey(request) as string);
  return json(body, replayed ? { headers: { 'Idempotent-Replay': 'true' } } : undefined);
});
