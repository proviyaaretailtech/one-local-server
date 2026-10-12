import { json, limit, route } from '../../../../../../server/http';
import { requireRider } from '../../../../../../server/rider';
import { resendDeliveryCode } from '../../../../../../server/rider-extra';

export const POST = route(async (request, params) => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-otp-resend', 10, 60000);
  return json(await resendDeliveryCode(rider, params?.id ?? ''));
});
