import { require, requirePartnerAuth } from '../../../server/partner';
import { createTestOrder } from '../../../server/restaurant';
import { json, limit, route } from '../../../server/http';

// A test order is a real order (a shared orders row, a kitchen alert on every device of the restaurant), so it is for managers only
// and a few an hour per restaurant, not for any staff member without limit (SRV-9 P3-2).
export const POST = route(async request => {
  const staff = await requirePartnerAuth(request);
  require(staff, 'outlet');
  limit(staff.organizationId, 'partner-test-order', 5, 3_600_000);
  return json(await createTestOrder(staff));
});
