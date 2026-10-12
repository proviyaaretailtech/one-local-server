import { getCatalog, inCity, resolveCity } from '../../../../server/catalog';
import { HttpError, json, route } from '../../../../server/http';

export const GET = route(async (request, { id }) => {
  const store = inCity((await getCatalog()).stores, resolveCity(request)).find(s => s.id === id);
  if (!store) throw new HttpError(404, 'Store not found');
  return json(store);
});
