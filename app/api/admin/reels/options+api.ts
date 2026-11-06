import { adminRoute, preflight } from '../../../../server/admin';
import { reelOptions } from '../../../../server/admin-reels';
import { json } from '../../../../server/http';

// The reel editor's pickers: { cities, products (?city=&q=, at most 100), brands }.
export const GET = adminRoute(async request => json(await reelOptions(request)));
export const OPTIONS = preflight;
