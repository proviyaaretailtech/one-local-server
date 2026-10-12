import { requirePartnerAuth } from '@/server/partner';
import { refundOnlinePayment } from '@/server/pos-payments';
import { json, readBody, route } from '@/server/http';

// POST /api/partner/payments/online/{attempt_id}/refund: capped at what was paid, idempotent per idempotency_key.
export const POST = route(async (request, params) => {
  const staff = await requirePartnerAuth(request);
  return json(await refundOnlinePayment(request, staff, params?.id ?? '', await readBody(request)));
});
