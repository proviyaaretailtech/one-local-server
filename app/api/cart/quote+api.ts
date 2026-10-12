import { resolveCity } from '../../../server/catalog';
import { json, readBody, route } from '../../../server/http';
import { limitCaller } from '../../../server/limits';
import { quote } from '../../../server/pricing';

// The cart's bill, worked out by the server with the same rules checkout uses.
export const POST = route(async request => {
  await limitCaller(request, 'quote', 120, 60_000, { verify: false });
  const body = await readBody<{ items?: unknown; coupon_code?: unknown }>(request);
  return json(await quote(resolveCity(request), body.items, body.coupon_code));
});
