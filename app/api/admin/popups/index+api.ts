import { adminRoute, paged, preflight } from '../../../../server/admin';
import { createPopup, listPopups } from '../../../../server/admin-popups';
import { json } from '../../../../server/http';

// Marketing pop-ups (?status=&city=, newest first), and creating one (it starts as a draft).
export const GET = adminRoute(async request => paged(await listPopups(request)));
export const POST = adminRoute(async request => json(await createPopup(request), { status: 201 }));
export const OPTIONS = preflight;
