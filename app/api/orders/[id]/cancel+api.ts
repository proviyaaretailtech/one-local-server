import { cancelOrder, cancelPreview } from '../../../../server/customer-cancel';
import { json, readBody, route } from '../../../../server/http';

// What would happen if the customer cancelled now: stage, refund share, fee. Nothing changes.
export const GET = route(async (request, params) => json(await cancelPreview(request, params?.id ?? '')));
// The customer cancels their own order. Body: { reason }. The refund is worked out by the database, never by the app.
export const POST = route(async (request, params) => json(await cancelOrder(request, params?.id ?? '', await readBody(request))));
