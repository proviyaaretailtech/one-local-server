import { requirePartnerAuth } from '@/server/partner';
import { onlinePaymentStatus } from '@/server/pos-payments';
import { json, route } from '@/server/http';

// GET /api/partner/payments/online/{attempt_id}: paid / pending / failed / dropped / expired / overpaid, decided from our row and Cashfree, never the browser.
export const GET = route(async (request, params) => {
  const staff = await requirePartnerAuth(request);
  return json(await onlinePaymentStatus(request, staff, params?.id ?? ''));
});
