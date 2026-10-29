import { getOrderFeedback } from '../../../../server/order-feedback';
import { json, route } from '../../../../server/http';

// GET /api/orders/:id/feedback -> { rating, issues } for the caller's own order.
export const GET = route(async (request, params) => json(await getOrderFeedback(request, params?.id ?? '')));
