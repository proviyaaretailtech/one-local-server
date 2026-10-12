import { json, limit, readBody, route } from '../../../server/http';
import { createUpload } from '../../../server/rider-extra';
import { ownRider } from '../../../server/rider-onboarding';

// Applicants upload their photo and documents before they are approved, so this needs only a rider row, not approval.
export const POST = route(async request => {
  const rider = await ownRider(request);
  limit(rider.id, 'rider-upload', 30, 60000);
  return json(await createUpload(rider, await readBody(request)));
});
