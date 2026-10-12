import { json, route } from '../../../server/http';
import { refundStatus } from '../../../server/cashfree-checkout';

// The refund line on the order screen: initiated / processed / failed, to the original payment method, 3-5 working days.
export const GET = route(async request => json(await refundStatus(request), { headers: { 'Cache-Control': 'no-store' } }));
