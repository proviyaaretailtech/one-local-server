import { require, requirePartnerAuth } from '../../../server/partner';
import { listItems } from '../../../server/restaurant';
import { json, route } from '../../../server/http';

export const GET = route(async request => {
  const staff = await requirePartnerAuth(request);
  require(staff, 'items');
  return json(await listItems(staff));
});
