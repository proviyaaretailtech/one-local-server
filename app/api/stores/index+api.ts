import { getCatalog, inCity, resolveCity } from '../../../server/catalog';
import { json, route } from '../../../server/http';

export const GET = route(async request => json(inCity((await getCatalog()).stores, resolveCity(request))));
