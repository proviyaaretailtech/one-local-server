import { adminRoute, getListing, preflight, updateListing } from '../../../../../server/admin';
import { json } from '../../../../../server/http';

export const GET = adminRoute(async (request, { id }) => json(await getListing(request, id ?? '')));
export const PATCH = adminRoute(async (request, { id }) => json(await updateListing(request, id ?? '')));
export const OPTIONS = preflight;
