import { HttpError, json, route } from '../../../../../server/http';
import { runIdempotent } from '../../../../../server/idempotency';
import { jobView, releaseJob, scopeJob, serviceRequest } from '../../../../../server/dispatch';

// Start offering the job to riders: the restaurant accepted (dispatch_trigger 'accepted'), or operations
// re-dispatching a job that found no rider. Does nothing if an offer round is already running.
export const POST = route(async (request, params) => {
  const call = await serviceRequest(request, { write: true });
  await scopeJob(call, { id: params?.id ?? '' });
  const { prep_minutes, expected_version } = call.body;
  if (prep_minutes != null && (!Number.isInteger(prep_minutes) || (prep_minutes as number) < 0 || (prep_minutes as number) > 240)) throw new HttpError(400, 'prep_minutes must be 0 to 240', undefined, 'invalid_payload');
  if (expected_version != null && !Number.isInteger(expected_version)) throw new HttpError(400, 'expected_version must be a whole number', undefined, 'invalid_payload');
  const id = params?.id ?? '';
  const out = await runIdempotent('dispatch:service', call.idempotencyKey, `POST release ${id}\n${JSON.stringify(call.body)}`, async () => {
    await releaseJob(id, (prep_minutes as number) ?? null, (expected_version as number) ?? null, call.requestId);
    return { body: await jobView(id) };
  });
  return json(out.body);
});
