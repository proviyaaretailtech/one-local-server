// Address and shop search for the pickup point, biased to the restaurant's city. The Google key stays on the server.
import { limitCaller } from '../../../../server/limits';
import { requirePartnerAuth } from '../../../../server/partner';
import { searchPickup } from '../../../../server/pickup-location';
import { json, route } from '../../../../server/http';

export const GET = route(async request => {
  const staff = await requirePartnerAuth(request);
  await limitCaller(request, 'pickup-search', 30, 60_000);
  return json(await searchPickup(staff, new URL(request.url).searchParams.get('q') ?? ''));
});
