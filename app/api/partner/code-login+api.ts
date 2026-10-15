// Sign in to the VINII Partner app with the code from the website sign-up. No login needed (that is the point).
import { codeLogin } from '../../../server/partner-code-login';
import { json, readBody, route } from '../../../server/http';

export const POST = route(async request => json(await codeLogin(request, await readBody(request, 2048)), { headers: { 'Cache-Control': 'no-store' } }));
