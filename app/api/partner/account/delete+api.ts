import { json, readBody, route } from '../../../../server/http';
import { deletePartnerAccount } from '../../../../server/partner-account';

// POST { confirm: "DELETE" } with the partner's sign-in token: deletes their account (server/partner-account.ts).
export const POST = route(async request => json(await deletePartnerAccount(request, await readBody(request))));
