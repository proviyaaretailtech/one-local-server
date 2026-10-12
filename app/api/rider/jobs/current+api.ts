import { json, route } from '../../../../server/http';
import { currentJob, requireRider } from '../../../../server/rider';

export const GET = route(async request => {
  const job = await currentJob(await requireRider(request));
  return job ? json(job) : new Response(null, { status: 204 });
});
