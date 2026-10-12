import { can, requirePartnerAuth } from '../../../server/partner';
import { getOutlet } from '../../../server/restaurant';
import { json, route } from '../../../server/http';

export const GET = route(async request => {
  const staff = await requirePartnerAuth(request);
  const outlet = await getOutlet(staff);
  return json({
    person: {
      id: staff.userId,
      email: staff.email,
      name: staff.name,
      role: staff.role,
      organization_id: staff.organizationId,
    },
    restaurant: {
      id: staff.organizationId,
      name: staff.organizationName,
      ...outlet,
    },
  });
});
