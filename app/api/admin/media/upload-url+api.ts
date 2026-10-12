import { adminRoute, preflight, uploadUrl } from '../../../../server/admin';
import { json } from '../../../../server/http';

// { folder: 'stores', filename, content_type, size? } -> a signed upload link and the image's public URL.
export const POST = adminRoute(async request => json(await uploadUrl(request)));
export const OPTIONS = preflight;
