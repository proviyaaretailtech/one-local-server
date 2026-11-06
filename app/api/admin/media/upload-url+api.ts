import { adminRoute, preflight, uploadUrl } from '../../../../server/admin';
import { json } from '../../../../server/http';

// { folder: 'stores' | 'popups' | 'reels', filename, content_type, size? } -> a signed upload link and the file's public URL.
export const POST = adminRoute(async request => json(await uploadUrl(request)));
export const OPTIONS = preflight;
