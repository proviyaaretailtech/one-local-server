import { require, requirePartnerAuth } from '../../../server/partner';
import { setOutlet } from '../../../server/restaurant';
import { json, readBody, route } from '../../../server/http';

export const PATCH = route(async request => {
  const staff = await requirePartnerAuth(request);
  require(staff, 'outlet');
  return json(await setOutlet(staff, await readBody(request)));
});
