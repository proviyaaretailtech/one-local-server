import { adminRoute, blockShopper, preflight } from '../../../../../server/admin';
import { json } from '../../../../../server/http';

// { blocked: boolean, reason } — a Supabase Auth ban (never a delete).
export const POST = adminRoute(async (request, { id }) => json(await blockShopper(request, id ?? '')));
export const OPTIONS = preflight;
