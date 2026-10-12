import { serviceability } from '../../server/catalog';
import { json, route } from '../../server/http';
import { limitCaller } from '../../server/limits';
import { parsePoint } from '../../server/maps';

// Free check (no Google call): does OneCity deliver to this point?
export const GET = route(async request => {
  await limitCaller(request, 'serviceability', 240, 60_000, { verify: false });
  return json(serviceability(parsePoint(new URL(request.url), true)!));
});
