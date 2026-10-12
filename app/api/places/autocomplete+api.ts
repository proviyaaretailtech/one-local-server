import { HttpError, json, route } from '../../../server/http';
import { limitCaller } from '../../../server/limits';
import { autocomplete, parsePoint } from '../../../server/maps';

export const GET = route(async request => {
  // Every call costs money, so searches are limited per device AND per network address (a device key is invented by the caller).
  await limitCaller(request, 'places', 60, 60_000, { verify: false });
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return json([]);
  if (q.length > 100) throw new HttpError(400, 'Please use a shorter search');
  return json(await autocomplete(q, parsePoint(url, false), url.searchParams.get('session')));
});
