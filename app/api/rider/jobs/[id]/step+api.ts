import { json, limit, readBody, route } from '../../../../../server/http';
import { commandOf, stepJob, requireRider } from '../../../../../server/rider';

export const POST = route(async (request, params) => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-command', 60, 60_000);
  const body = await readBody(request);
  const result = await stepJob(rider, params?.id ?? '', body, await commandOf(request, body));
  return json(result, result.replayed ? { headers: { 'Idempotent-Replay': 'true' } } : undefined);
});
