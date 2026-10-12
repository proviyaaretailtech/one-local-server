import { resolveCity } from '../../../server/catalog';
import { caller } from '../../../server/auth';
import { json, route } from '../../../server/http';
import { idempotent } from '../../../server/idempotency';
import { createOrder, listOrders } from '../../../server/store';

// Every store order, newest first; orders placed together share a checkout_id.
export const GET = route(async request => json(await listOrders(request)));
// Older app versions: places the checkout (POST /api/checkouts) and answers with its first order.
export const POST = route(async request => idempotent(request, (await caller(request)).owner, () => createOrder(request, resolveCity(request))));
