import { coverage } from '../../server/coverage';
import { json, route } from '../../server/http';
import { limitCaller } from '../../server/limits';
import { parsePoint } from '../../server/maps';

// What One Local offers at a map position: live (we deliver), discover (listings only) or soon.
export const GET = route(async request => {
  await limitCaller(request, 'coverage', 120, 60_000, { verify: false });
  return json(await coverage(parsePoint(new URL(request.url), true)!));
});
