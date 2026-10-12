import { requirePartnerAuth } from '@/server/partner';
import { startOnlinePayment } from '@/server/pos-payments';
import { json, readBody, route } from '@/server/http';

// POST /api/partner/payments/online: the guest bill's "Pay online" (contract: PAYMENTS_CASHFREE.md, "As built").
export const POST = route(async request => {
  const staff = await requirePartnerAuth(request);
  return json(await startOnlinePayment(request, staff, await readBody(request)));
});
