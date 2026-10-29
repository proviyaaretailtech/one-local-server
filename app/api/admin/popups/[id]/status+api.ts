import { adminRoute, preflight } from '../../../../../server/admin';
import { popupAction } from '../../../../../server/admin-popups';
import { json } from '../../../../../server/http';

// Move a pop-up through its workflow. Body: { action: submit | return | approve | end, note? }. Approve needs a second person.
export const POST = adminRoute(async (request, params) => json(await popupAction(request, params?.id ?? '')));
export const OPTIONS = preflight;
