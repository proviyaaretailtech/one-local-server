import { json, route } from '../../../server/http';
import { getOrder } from '../../../server/store';

export const GET = route(async (request, { id }) => json(await getOrder(request, id)));
