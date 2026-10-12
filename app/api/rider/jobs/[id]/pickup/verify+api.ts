import { json, limit, readBody, route } from '../../../../../../server/http';
import { commandOf, requireRider, verifyPickupApp } from '../../../../../../server/rider';

// The Rider app's pickup check: POST /rider/jobs/:id/pickup/verify. The older /pickup-verify stays for callers that use its body.
export const POST = route(async (request, params) => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-command', 60, 60_000);
  const body = await readBody(request);
  const result = await verifyPickupApp(rider, params?.id ?? '', body, await commandOf(request, body));
  return json(result, 'replayed' in result && result.replayed ? { headers: { 'Idempotent-Replay': 'true' } } : undefined);
});
