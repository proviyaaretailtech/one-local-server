import { requirePartnerAuth } from '../../../server/partner';
import { registerDevice } from '../../../server/restaurant';
import { json, route, readBody } from '../../../server/http';

export const PUT = route(async request => {
  const staff = await requirePartnerAuth(request);
  const body = await readBody(request);
  return json(await registerDevice(staff, body));
});
