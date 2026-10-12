import { applyCoupon } from '../../../server/catalog';
import { HttpError, json, readBody, route } from '../../../server/http';
import { limitCaller } from '../../../server/limits';

export const POST = route(async request => {
  // Coupon codes are guessable, so attempts are limited per device and per network address.
  await limitCaller(request, 'coupon', 10, 60_000, { verify: false, anonIpMax: 20 });
  const body = await readBody<{ code?: unknown; subtotal?: unknown }>(request);
  if (typeof body.code !== 'string' || body.code.length > 30 || typeof body.subtotal !== 'number' || body.subtotal < 0) throw new HttpError(400, 'Enter a coupon code');
  return json(await applyCoupon(body.code, body.subtotal));
});
