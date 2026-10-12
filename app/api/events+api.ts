import { getCatalog, inCity, resolveCity } from '../../server/catalog';
import { json, route } from '../../server/http';

export const GET = route(async request => {
  const kind = new URL(request.url).searchParams.get('kind');
  return json(inCity((await getCatalog()).events, resolveCity(request)).filter(e => !kind || e.kind === kind));
});
