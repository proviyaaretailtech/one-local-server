import { adminRoute, demand, preflight } from '../../../server/admin';
import { json } from '../../../server/http';

// "Bring One Local to my town" requests, counted per place.
export const GET = adminRoute(async request => json(await demand(request)));
export const OPTIONS = preflight;
