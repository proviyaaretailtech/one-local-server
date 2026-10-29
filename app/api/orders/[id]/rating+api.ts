import { rateOrder } from '../../../../server/order-feedback';
import { json, route } from '../../../../server/http';

// POST /api/orders/:id/rating { rating, delivery_rating?, comment? } for a delivered order that is the caller's own.
export const POST = route(async (request, params) => json(await rateOrder(request, params?.id ?? '')));
