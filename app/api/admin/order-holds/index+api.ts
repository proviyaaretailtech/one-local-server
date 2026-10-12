import { adminRoute, audit, preflight, requireAdmin } from '../../../../server/admin';
import { json } from '../../../../server/http';
import { openHolds } from '../../../../server/order-risk';

// Orders held for review (order-risk.ts), oldest first: what operations must look at before a restaurant sees them.
export const GET = adminRoute(async request => { const admin = await requireAdmin(request, false); audit(admin, 'order_holds.list', '-'); return json(await openHolds()); });
export const OPTIONS = preflight;
