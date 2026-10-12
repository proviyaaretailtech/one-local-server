import { json, route } from '../../../server/http';
import { getCheckout } from '../../../server/store';

// A checkout with all its store orders, for the customer who placed it.
export const GET = route(async (request, { id }) => json(await getCheckout(request, id)));
