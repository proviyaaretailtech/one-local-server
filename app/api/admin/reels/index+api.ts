import { adminRoute, paged, preflight } from '../../../../server/admin';
import { createReel, listReels } from '../../../../server/admin-reels';
import { json } from '../../../../server/http';

// Reels (?city=&status=active|paused, in the order customers see them), and adding one (body: the editor's fields, status optional).
export const GET = adminRoute(async request => paged(await listReels(request)));
export const POST = adminRoute(async request => json(await createReel(request), { status: 201 }));
export const OPTIONS = preflight;
