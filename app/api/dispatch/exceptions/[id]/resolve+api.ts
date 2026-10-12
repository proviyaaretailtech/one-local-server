import { HttpError, json, route } from '../../../../../server/http';
import { resolveException, scopeException, serviceRequest } from '../../../../../server/dispatch';

const OUTCOMES = ['resume', 'reassign', 'return', 'fail', 'cancel'];

// Operations closes a problem a rider reported on a job.
export const POST = route(async (request, params) => {
  const call = await serviceRequest(request, { write: true });
  await scopeException(call, params?.id ?? '');
  const { outcome, note } = call.body;
  if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome)) throw new HttpError(400, `outcome must be one of ${OUTCOMES.join(', ')}`, undefined, 'invalid_payload');
  const { job, ...result } = await resolveException(params?.id ?? '', outcome, typeof note === 'string' ? note.slice(0, 500) : null, call.requestId);
  return json({ ...result, job });
});
