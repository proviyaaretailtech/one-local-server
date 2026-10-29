import { adminRoute, preflight } from '../../../../../server/admin';
import { getPopup, updatePopup } from '../../../../../server/admin-popups';
import { json } from '../../../../../server/http';

// One pop-up with its history; PUT replaces a draft (a submitted, live or ended one cannot be edited).
export const GET = adminRoute(async (request, params) => json(await getPopup(request, params?.id ?? '')));
export const PUT = adminRoute(async (request, params) => json(await updatePopup(request, params?.id ?? '')));
export const OPTIONS = preflight;
