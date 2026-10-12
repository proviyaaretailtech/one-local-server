import { resolveCity } from '../../../server/catalog';
import { caller } from '../../../server/auth';
import { json, route } from '../../../server/http';
import { idempotent } from '../../../server/idempotency';
import { startPayment } from '../../../server/payments';

// Saves the order (payment pending) and opens a Razorpay order for the server's total.
export const POST = route(async request => idempotent(request, (await caller(request)).owner, () => startPayment(request, resolveCity(request))));
