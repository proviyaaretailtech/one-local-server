import { json, limit, readBody, route } from '../../../server/http';
import { ownRider, setType } from '../../../server/rider-onboarding';

export const PUT = route(async (request, params) => {
  const applicant = await ownRider(request, { editing: true });
  limit(applicant.id, 'rider-onboard', 30, 60000);
  return json(await setType(applicant, await readBody(request)));
});
