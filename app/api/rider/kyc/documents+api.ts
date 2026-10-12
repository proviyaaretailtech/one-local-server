import { json, limit, readBody, route } from '../../../../server/http';
import { ownRider, addDocument } from '../../../../server/rider-onboarding';

export const POST = route(async (request, params) => {
  const applicant = await ownRider(request, { editing: true });
  limit(applicant.id, 'rider-kyc', 20, 60000);
  return json(await addDocument(applicant, await readBody(request)));
});
