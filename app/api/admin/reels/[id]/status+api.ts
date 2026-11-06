import { adminRoute, preflight } from '../../../../../server/admin';
import { setReelStatus } from '../../../../../server/admin-reels';
import { json } from '../../../../../server/http';

// Show a reel to customers or pause it. Body: { status: active | paused }.
export const POST = adminRoute(async (request, params) => json(await setReelStatus(request, params?.id ?? '')));
export const OPTIONS = preflight;
