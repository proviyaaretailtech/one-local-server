import { adminRoute, preflight, setListingStatus } from '../../../../../server/admin';
import { json } from '../../../../../server/http';

// { status: 'live' | 'paused' | 'pending', reason? }. Going live needs at least one item on One Local.
export const POST = adminRoute(async (request, { id }) => json(await setListingStatus(request, id ?? '')));
export const OPTIONS = preflight;
