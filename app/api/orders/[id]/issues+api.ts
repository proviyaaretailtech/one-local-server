import { reportIssue } from '../../../../server/order-feedback';
import { json, route } from '../../../../server/http';

// POST /api/orders/:id/issues { order_item_id, kind, qty?, note? } opens a case for one item of a delivered order. It moves no money.
export const POST = route(async (request, params) => json(await reportIssue(request, params?.id ?? '')));
