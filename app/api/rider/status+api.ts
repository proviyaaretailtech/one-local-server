import { json, limit, route } from '../../../server/http';
import { ownRider, status } from '../../../server/rider-onboarding';

export const GET = route(async (request, params) => {
  const applicant = await ownRider(request);
  limit(applicant.id, 'rider-read', 120, 60000);
  return json(await status(applicant));
});
