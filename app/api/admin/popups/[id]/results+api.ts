import { adminRoute, preflight } from '../../../../../server/admin';
import { popupResults } from '../../../../../server/admin-popups';
import { json } from '../../../../../server/http';

// Shown / tapped / closed per day (IST) and how many people saw it.
export const GET = adminRoute(async (request, params) => json(await popupResults(request, params?.id ?? '')));
export const OPTIONS = preflight;
