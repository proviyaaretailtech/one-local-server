import { json, limit, route } from '../../../server/http';
import { ownRider, submit } from '../../../server/rider-onboarding';

export const POST = route(async (request, params) => {
  const applicant = await ownRider(request);
  limit(applicant.id, 'rider-submit', 10, 60000);
  return json(await submit(applicant));
});
