import { adminRoute, paged, preflight, shoppers } from '../../../../server/admin';

// Shoppers (Supabase Auth users), ?q= email or phone, ?page= (50 per page); newest first.
export const GET = adminRoute(async request => paged(await shoppers(request)));
export const OPTIONS = preflight;
