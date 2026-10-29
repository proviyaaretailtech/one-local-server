import { storeEtas } from '../../server/eta';
import { HttpError, json, route } from '../../server/http';

// GET /api/eta?lat=&lng= -> { etas: { <store id>: minutes } } for the stores that can say how long they would take to reach that point.
export const GET = route(async request => {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat')); const lng = Number(url.searchParams.get('lng'));
  if (!url.searchParams.get('lat') || !url.searchParams.get('lng') || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'lat and lng are required');
  return json({ etas: await storeEtas({ lat, lng }) });
});
