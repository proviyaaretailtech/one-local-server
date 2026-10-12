import { json, route } from '../../../server/http';
import { verifyPayment } from '../../../server/payments';

// The app reports Razorpay Checkout's success; the signature is checked before the order is marked paid.
export const POST = route(async request => json(await verifyPayment(request)));
