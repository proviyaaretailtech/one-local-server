import { json, route } from '../../../../server/http';
import { runIdempotent } from '../../../../server/idempotency';
import { createJob, jobViewByOrder, parseJobPayload, scopeJob, serviceRequest, verifyJobOrigin } from '../../../../server/dispatch';

// Server to server (a service credential, never a user's token). The order flow calls this the moment a
// delivery order is successful; it creates the one job for the order and pings the rider pool.
export const POST = route(async request => {
  const call = await serviceRequest(request, { write: true });
  const claimed = parseJobPayload(call.body);
  call.allowOrg(claimed.organization_id); // the organization the caller says the order is for
  const payload = await verifyJobOrigin(claimed); // ... checked against the order and its store, which say what it really is
  call.allowOrg(payload.organization_id);
  const out = await runIdempotent('dispatch:service', call.idempotencyKey, `POST jobs\n${JSON.stringify(call.body)}`, async () => {
    const { created, job } = await createJob(payload, call.requestId);
    return { status: created ? 201 : 200, body: job };
  });
  return json(out.body, { status: out.replayed ? 200 : (out.status ?? 200) }); // the same call again answers 200, as before
});

// ?ol_order_id=<uuid>: the same read as /jobs/:job_id, for a caller that only knows the order.
export const GET = route(async request => {
  const call = await serviceRequest(request, { write: false });
  const id = new URL(request.url).searchParams.get('ol_order_id') ?? '';
  await scopeJob(call, { ol_order_id: id });
  return json(await jobViewByOrder(id));
});
