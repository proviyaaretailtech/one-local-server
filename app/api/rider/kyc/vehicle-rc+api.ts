import { json, limit, readBody, route } from '../../../../server/http';
import { ownRider, verifyKyc } from '../../../../server/rider-onboarding';

// POST /api/rider/kyc/vehicle-rc  one Cashfree Secure ID check; the answer is the document, as from POST /api/rider/kyc/documents.
export const POST = route(async (request, params) => {
  const applicant = await ownRider(request);
  limit(applicant.id, 'rider-kyc', 20, 60000);
  return json(await verifyKyc(applicant, 'rc', await readBody(request)));
});
