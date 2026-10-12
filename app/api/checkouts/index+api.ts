import { resolveCity } from '../../../server/catalog';
import { caller } from '../../../server/auth';
import { json, route } from '../../../server/http';
import { idempotent } from '../../../server/idempotency';
import { createCheckout } from '../../../server/store';

// Cash on delivery: saves the checkout, one order per store in it (online payments start at
// POST /api/payments/order instead).
export const POST = route(async request => idempotent(request, (await caller(request)).owner, () => createCheckout(request, resolveCity(request))));
