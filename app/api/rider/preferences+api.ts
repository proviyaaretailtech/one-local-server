import { json, limit, readBody, route } from '../../../server/http';
import { ownRider, setPreferences } from '../../../server/rider-onboarding';

export const PUT = route(async (request, params) => {
  const applicant = await ownRider(request);
  limit(applicant.id, 'rider-onboard', 30, 60000);
  return json(await setPreferences(applicant, await readBody(request)));
});
