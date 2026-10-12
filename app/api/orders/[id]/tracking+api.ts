import { json, route } from '../../../../server/http';
import { limitCaller } from '../../../../server/limits';
import { orderTracking } from '../../../../server/tracking';

// GET /api/orders/:id/tracking: the customer's live view of their own order (rider, route, ETA). Anyone else's order is a 404.
export const GET = route(async (request, { id }) => {
  await limitCaller(request, 'order-tracking', 30, 60_000);
  return json(await orderTracking(request, id));
});
