import { json, limit, readBody, route } from '../../../server/http';
import { ownRider, linkStore } from '../../../server/rider-onboarding';

export const POST = route(async (request, params) => {
  const applicant = await ownRider(request, { editing: true });
  limit(applicant.id, 'rider-store-link', 10, 60000);
  return json(await linkStore(applicant, await readBody(request)));
});
