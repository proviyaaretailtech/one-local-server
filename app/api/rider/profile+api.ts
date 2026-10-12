import { json, limit, readBody, route } from '../../../server/http';
import { ownRider, setProfile } from '../../../server/rider-onboarding';

export const PUT = route(async (request, params) => {
  const applicant = await ownRider(request);
  limit(applicant.id, 'rider-onboard', 30, 60000);
  return json(await setProfile(applicant, await readBody(request)));
});
