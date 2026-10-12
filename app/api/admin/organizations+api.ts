import { adminRoute, organizations, preflight } from '../../../server/admin';
import { json } from '../../../server/http';

// Organizations (OS) with their outlets, Item Master size and One Local listing, ?q= to search.
export const GET = adminRoute(async request => json(await organizations(request)));
export const OPTIONS = preflight;
