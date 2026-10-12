import { json, limit, route } from '../../../../../server/http';
import { digilockerStatus, ownRider } from '../../../../../server/rider-onboarding';

// GET /api/rider/kyc/digilocker/status?verification_id=  how the rider's DigiLocker session went (verified, pending or rejected).
export const GET = route(async (request, params) => {
  const applicant = await ownRider(request);
  limit(applicant.id, 'rider-kyc', 20, 60000);
  return json(await digilockerStatus(applicant, new URL(request.url).searchParams.get('verification_id')));
});
