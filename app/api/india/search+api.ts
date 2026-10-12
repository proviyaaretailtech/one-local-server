import { HttpError, json, route } from '../../../server/http';
import { limitCaller } from '../../../server/limits';
import { searchIndia } from '../../../server/geo';
import { parsePoint } from '../../../server/maps';

// Any city, town, locality or village in India (our own list — free, no Google call).
export const GET = route(async request => {
  await limitCaller(request, 'india-search', 120, 60_000, { verify: false });
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length > 80) throw new HttpError(400, 'Please use a shorter search');
  return json(searchIndia(q, parsePoint(url, false)));
});
