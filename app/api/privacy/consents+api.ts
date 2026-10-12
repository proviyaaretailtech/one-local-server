import { json, route } from '../../../server/http';
import { currentConsents, recordConsents } from '../../../server/privacy';

// Consent choices: GET the newest per purpose, POST new ones (append-only, with the notice version).
export const GET = route(async request => json(await currentConsents(request), { headers: { 'Cache-Control': 'no-store' } }));
export const POST = route(async request => json(await recordConsents(request)));
