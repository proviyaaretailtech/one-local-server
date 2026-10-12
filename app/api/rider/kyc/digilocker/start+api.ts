import { json, limit, route } from '../../../../../server/http';
import { ownRider, startDigilocker } from '../../../../../server/rider-onboarding';

export const POST = route(async (request, params) => {
  const applicant = await ownRider(request);
  limit(applicant.id, 'rider-kyc', 20, 60000);
  return json(await startDigilocker(applicant, request));
});
