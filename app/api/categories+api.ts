import { getCatalog } from '../../server/catalog';
import { json, route } from '../../server/http';

export const GET = route(async () => json((await getCatalog()).categories));
