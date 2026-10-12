import { json, limit, readBody, route } from '../../../server/http';
import { requireUser, register } from '../../../server/rider-onboarding';

export const POST = route(async (request, params) => {
  const userId = await requireUser(request);
  limit(userId, 'rider-onboard', 20, 60000);
  return json(await register(userId, await readBody(request)));
});
