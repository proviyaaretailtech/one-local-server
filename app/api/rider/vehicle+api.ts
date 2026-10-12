import { json, limit, readBody, route } from '../../../server/http';
import { ownRider, setVehicle } from '../../../server/rider-onboarding';

export const PUT = route(async (request, params) => {
  const applicant = await ownRider(request, { editing: true });
  limit(applicant.id, 'rider-onboard', 30, 60000);
  return json(await setVehicle(applicant, await readBody(request)));
});
