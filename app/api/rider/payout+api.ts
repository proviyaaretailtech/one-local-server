import { json, limit, readBody, route } from '../../../server/http';
import { ownRider, setPayoutMethod } from '../../../server/rider-onboarding';

export const PUT = route(async (request, params) => {
  const applicant = await ownRider(request);
  limit(applicant.id, 'rider-payout-method', 10, 60000);
  return json(await setPayoutMethod(applicant, await readBody(request)));
});
