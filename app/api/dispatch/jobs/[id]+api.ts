import { json, route } from '../../../../server/http';
import { jobView, scopeJob, serviceRequest } from '../../../../server/dispatch';

// What One Local's tracking screen and VINII's order detail read: status, rider first name and position, ETA.
export const GET = route(async (request, params) => {
  const call = await serviceRequest(request, { write: false });
  await scopeJob(call, { id: params?.id ?? '' });
  return json(await jobView(params?.id ?? ''));
});
