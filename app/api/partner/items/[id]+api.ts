import { require, requirePartnerAuth } from '../../../../server/partner';
import { setItem } from '../../../../server/restaurant';
import { json, route, readBody } from '../../../../server/http';

export const PATCH = route(async (request, params) => {
  const staff = await requirePartnerAuth(request);
  require(staff, 'items');
  const body = await readBody(request);
  return json(await setItem(staff, params?.id ?? '', body));
});
