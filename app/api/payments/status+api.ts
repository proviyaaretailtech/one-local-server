import { json, route } from '../../../server/http';
import { checkoutStatus } from '../../../server/cashfree-checkout';

// The one answer the app believes about a payment. Re-reads Cashfree while the payment is still pending; safe to call every 2 seconds.
export const GET = route(async request => json(await checkoutStatus(request), { headers: { 'Cache-Control': 'no-store' } }));
