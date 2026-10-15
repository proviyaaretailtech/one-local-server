// The address under the pickup pin, and whether the pin is inside the restaurant's delivery area.
import { limitCaller } from '../../../../server/limits';
import { parsePoint } from '../../../../server/maps';
import { requirePartnerAuth } from '../../../../server/partner';
import { reversePickup } from '../../../../server/pickup-location';
import { json, route } from '../../../../server/http';

export const GET = route(async request => {
  const staff = await requirePartnerAuth(request);
  const point = parsePoint(new URL(request.url), true)!;
  await limitCaller(request, 'pickup-reverse', 30, 60_000);
  return json(await reversePickup(staff, point.lat, point.lng));
});
