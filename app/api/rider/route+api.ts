import { limit, json, readBody, route } from '../../../server/http';
import { requireRider } from '../../../server/rider';
import { riderRoute } from '../../../server/tracking';

// POST /api/rider/route { job_id, from: { lat, lng } } -> { target, destination, route }. The destination is the pickup or the drop of the
// rider's own job, worked out here: the app never sends one (specs/live-navigation-eta).
export const POST = route(async request => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-route', 20, 60_000);
  return json(await riderRoute(rider, await readBody(request)));
});
