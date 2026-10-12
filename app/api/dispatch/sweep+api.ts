import { json, route } from '../../../server/http';
import { requireUnrestricted, serviceRequest, sweep } from '../../../server/dispatch';

// Run by a scheduler every 15-30 seconds: moves lapsed offers on, escalates a dead pool, cancels jobs of
// cancelled orders, and creates the job for any successful order that does not have one.
export const POST = route(async request => {
  const call = await serviceRequest(request, { write: true });
  requireUnrestricted(call); // the sweep works on every job, so a credential limited to some organizations may not run it
  return json(await sweep(call.requestId));
});
