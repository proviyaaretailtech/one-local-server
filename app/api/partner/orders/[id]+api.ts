import { requirePartnerAuth } from '@/server/partner';
import { getOrder } from '@/server/restaurant';
import { json, route } from '@/server/http';

export const GET = route(async (request, params) => {
  const staff = await requirePartnerAuth(request);
  return json(await getOrder(staff, params?.id ?? ''));
});
