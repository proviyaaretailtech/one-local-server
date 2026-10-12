import { json, limit, route } from '../../../server/http';
import { requireUser, lookupZone } from '../../../server/rider-onboarding';

export const GET = route(async (request, params) => {
  const userId = await requireUser(request);
  limit(userId, 'geo-zones', 60, 60000);
  return json(await lookupZone(new URL(request.url).searchParams));
});
