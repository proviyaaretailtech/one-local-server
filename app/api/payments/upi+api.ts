import { caller } from '../../../server/auth';
import { route } from '../../../server/http';
import { idempotent } from '../../../server/idempotency';
import { startUpi } from '../../../server/cashfree-checkout';

// Optional direct UPI for a checkout that is already open (POST /payments/order): intent link, QR, or collect request. Collect comes last.
export const POST = route(async request => idempotent(request, (await caller(request)).owner, () => startUpi(request)));
