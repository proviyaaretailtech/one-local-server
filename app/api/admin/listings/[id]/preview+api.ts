import { adminRoute, preflight, previewListing } from '../../../../../server/admin';
import { json } from '../../../../../server/http';

// Exactly what the app will show for this listing: store, categories and the items live on One Local.
export const GET = adminRoute(async (request, { id }) => json(await previewListing(request, id ?? '')));
export const OPTIONS = preflight;
