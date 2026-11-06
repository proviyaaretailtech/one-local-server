import { adminRoute, preflight } from '../../../../../server/admin';
import { deleteReel, getReel, updateReel } from '../../../../../server/admin-reels';
import { json } from '../../../../../server/http';

// One reel; PUT replaces the editor's fields; DELETE hides it from customers for good (the row is kept with deleted_at).
export const GET = adminRoute(async (request, params) => json(await getReel(request, params?.id ?? '')));
export const PUT = adminRoute(async (request, params) => json(await updateReel(request, params?.id ?? '')));
export const DELETE = adminRoute(async (request, params) => json(await deleteReel(request, params?.id ?? '')));
export const OPTIONS = preflight;
