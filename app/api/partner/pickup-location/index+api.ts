// The restaurant's pickup point (specs/restaurant-pickup-location). GET: any staff member. PUT: owner, admin or manager.
import { idempotencyKey, idempotent } from '../../../../server/idempotency';
import { requirePartnerAuth } from '../../../../server/partner';
import { getPickupLocation, setPickupLocation } from '../../../../server/pickup-location';
import { json, readBody, route } from '../../../../server/http';

export const GET = route(async request => {
  const staff = await requirePartnerAuth(request);
  return json(await getPickupLocation(staff));
});

export const PUT = route(async request => {
  const staff = await requirePartnerAuth(request);
  const key = idempotencyKey(request);
  return idempotent(request, `partner:${staff.organizationId}:${staff.userId}`, async () => setPickupLocation(staff, await readBody(request), key));
});
