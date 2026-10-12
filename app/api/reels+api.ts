import { reelsFor, resolveCity } from '../../server/catalog';
import { json, route } from '../../server/http';

export const GET = route(async request => json(await reelsFor(resolveCity(request))));
