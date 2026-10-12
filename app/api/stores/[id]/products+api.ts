import { getCatalog, inCity, resolveCity } from '../../../../server/catalog';
import { json, route } from '../../../../server/http';

export const GET = route(async (request, { id }) => json(inCity((await getCatalog()).products, resolveCity(request)).filter(p => p.store_id === id)));
