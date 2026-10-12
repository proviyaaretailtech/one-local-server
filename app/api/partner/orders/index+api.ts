import { requirePartnerAuth } from '../../../../server/partner';
import { listOrders, type Tab } from '../../../../server/restaurant';
import { json, route } from '../../../../server/http';

export const GET = route(async request => {
  const staff = await requirePartnerAuth(request);
  const { searchParams } = new URL(request.url);
  const tab = (searchParams.get('tab') ?? 'new') as Tab;
  return json(await listOrders(staff, tab));
});
