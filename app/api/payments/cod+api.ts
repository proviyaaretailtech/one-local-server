import { caller } from '../../../server/auth';
import { route } from '../../../server/http';
import { idempotent } from '../../../server/idempotency';
import { switchToCash } from '../../../server/payments';

// After a failed or cancelled online payment: the same order becomes pay on delivery.
export const POST = route(async request => idempotent(request, (await caller(request)).owner, () => switchToCash(request)));
