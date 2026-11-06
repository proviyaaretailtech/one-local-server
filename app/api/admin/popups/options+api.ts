import { adminRoute, preflight } from '../../../../server/admin';
import { popupOptions } from '../../../../server/admin-popups';
import { json } from '../../../../server/http';

// What the pop-up editor offers: { cities: [{ id, name }], screens: [...] }.
export const GET = adminRoute(async request => json(await popupOptions(request)));
export const OPTIONS = preflight;
