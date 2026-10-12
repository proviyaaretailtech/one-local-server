import { json, route } from '../../../../server/http';
import { jobDetail, jobForRider, requireRider } from '../../../../server/rider';

// A rider sees only their own jobs, in the rider's view: area before pickup, address after.
// ?detail=true answers {job, events, proof, pickup_check, earnings} for the job screen.
export const GET = route(async (request, params) => {
  const rider = await requireRider(request);
  const id = params?.id ?? '';
  return json(new URL(request.url).searchParams.get('detail') === 'true' ? await jobDetail(rider, id) : await jobForRider(rider, id));
});
