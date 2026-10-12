import { json, readBody, route } from '../../server/http';
import { submitPartnerApplication } from '../../server/partner-applications';

// The partner website calls this from the browser, so it answers CORS for the site's origin(s) only.
// PARTNER_SITE_ORIGINS: comma-separated, e.g. "https://partners.onelocal.in"; local development allows localhost.
function corsOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const allowed = (process.env.PARTNER_SITE_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  // Development: this machine, or a phone on the same Wi-Fi (private network addresses only).
  const local = process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin);
  return allowed.includes(origin) || local ? origin : null;
}
function withCors(request: Request, response: Response): Response {
  const origin = corsOrigin(request);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin); headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS'); headers.set('Access-Control-Allow-Headers', 'content-type, x-city');
  headers.set('Access-Control-Expose-Headers', 'Retry-After');
  return new Response(response.body, { status: response.status, headers });
}

const handle = route(async request => json(await submitPartnerApplication(request, await readBody(request)), { status: 201 }));
export const POST = async (request: Request, params: Record<string, string>) => withCors(request, await handle(request, params));
export const OPTIONS = (request: Request) => withCors(request, new Response(null, { status: 204 }));
