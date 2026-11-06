import { adminRoute, preflight } from '../../../../server/admin';
import { reorderReels } from '../../../../server/admin-reels';
import { json } from '../../../../server/http';

// Put a city's reels in order. Body: { city_id, ids } with every reel of the city once, first = top.
export const POST = adminRoute(async request => json(await reorderReels(request)));
export const OPTIONS = preflight;
