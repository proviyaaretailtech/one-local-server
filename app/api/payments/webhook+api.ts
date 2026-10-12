import { json, route } from '../../../server/http';
import { handleCashfreeWebhook } from '../../../server/cashfree-checkout';
import { handleWebhook } from '../../../server/payments';

// Gateway -> us. Cashfree signs with x-webhook-signature (its client secret); Razorpay with x-razorpay-signature (RAZORPAY_WEBHOOK_SECRET).
// The source of truth if the app was closed mid-payment. Each event is handled once (payment_webhook_events); a repeat answers 200.
export const POST = route(async request => json(request.headers.has('x-webhook-signature') ? await handleCashfreeWebhook(request) : await handleWebhook(request)));
// Cashfree's dashboard (and a person with a browser) can check that the address is alive.
export const GET = route(async () => json({ ok: true }));
