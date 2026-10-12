import { adminRoute, me, preflight } from '../../../server/admin';
import { json } from '../../../server/http';

// Who the Master's signed-in user is to One Local, and whether they may change things.
export const GET = adminRoute(async request => json(await me(request)));
export const OPTIONS = preflight;
