import { adminRoute, devFile, devUpload, preflight } from '../../../../../server/admin';
import { json } from '../../../../../server/http';

// Memory mode only (no database, not production): stands in for Supabase Storage so the Master can
// upload and show images while developing. 404 everywhere else.
export const PUT = adminRoute(async (request, { key }) => json(await devUpload(request, key ?? '')));
export const GET = adminRoute(async (_request, { key }) => devFile(key ?? ''));
export const OPTIONS = preflight;
