import { HttpError, json, route } from '../../../server/http';
import { eventsAfter, serviceRequest } from '../../../server/dispatch';

// GET /api/dispatch/events?after=<id>&limit=<n>: the delivery event outbox by cursor. Every event is written with its change.
export const GET = route(async request => {
  const call = await serviceRequest(request, { write: false });
  const url = new URL(request.url);
  const after = Number(url.searchParams.get('after') ?? 0), limit = Number(url.searchParams.get('limit') ?? 100);
  if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit)) throw new HttpError(400, 'after and limit must be whole numbers', undefined, 'invalid_payload');
  return json(await eventsAfter(after, limit, call));
});
