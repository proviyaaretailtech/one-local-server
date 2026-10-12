import { HttpError, json, route } from '../../../../../server/http';
import { runIdempotent } from '../../../../../server/idempotency';
import { reassignJob, scopeJob, serviceRequest } from '../../../../../server/dispatch';

// Operations takes the job from its rider before pickup and offers it to the next riders. After pickup: 409 already_picked_up.
export const POST = route(async (request, params) => {
  const call = await serviceRequest(request, { write: true });
  await scopeJob(call, { id: params?.id ?? '' });
  const reason = typeof call.body.reason === 'string' ? call.body.reason.trim().slice(0, 200) : '';
  if (!reason) throw new HttpError(400, 'reason is required', undefined, 'invalid_payload');
  const out = await runIdempotent('dispatch:service', call.idempotencyKey, `POST reassign ${params?.id}\n${JSON.stringify(call.body)}`, async () => ({ body: (await reassignJob(params?.id ?? '', reason, call.requestId)).job }));
  return json(out.body);
});
