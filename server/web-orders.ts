// Web orders: the order door of a restaurant's own guest page (table QR or brand page, served by the POS server's guest web app).
// Spec: specs/guest-experience-builder/spec-part2-live-orders.md, contract A (workspace root). Database: partner migration 0660.
//
//   POST /api/web/orders          place  (Idempotency-Key required)  -> ol_web_order_place
//   POST /api/web/orders/status   follow (by tracking link, or by order id with the same device key) -> ol_web_order_status
//   POST /api/web/orders/bill     ask for the bill -> ol_web_order_bill
//
// Who: nobody signs in. The guest browser keeps its own random device key (x-customer-key, 24-128 letters) and only its hash reaches the
// database, exactly like the app's anonymous orders. The table of a dine-in order comes from the guest's QR session, never from the body;
// every price, rule and state check is in the database. Calls from browsers are allowed only from the guest page's origins (CORS below).
import { z } from 'zod';
import { db, fromDbError } from './db';
import { customerKey, HttpError, readText, sha256 } from './http';
import { idempotencyKey } from './idempotency';
import { limitCaller } from './limits';
import { pushToRestaurant } from './push';

type Row = Record<string, any>;
type Handler = (request: Request) => Promise<Response>;

// ---------- CORS: the guest page's origins only ----------
const ORIGINS = ['https://onelocal.co', 'https://www.onelocal.co', 'https://menu.onelocal.co'];
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;
const ALLOW_HEADERS = 'content-type, x-customer-key, idempotency-key';

/** The origin to answer with; null = no browser origin (a server or curl); false = a website that may not call. */
export function allowedOrigin(request: Request): string | null | false {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const extra = (process.env.WEB_ORDER_ORIGINS ?? '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  if (ORIGINS.includes(origin) || extra.includes(origin)) return origin;
  if (process.env.NODE_ENV !== 'production' && LOCAL.test(origin)) return origin;
  return false;
}

function withCors(response: Response, origin: string | null): Response {
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Expose-Headers', 'Retry-After');
  headers.append('Vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function webPreflight(request: Request): Response {
  const origin = allowedOrigin(request);
  if (origin === false) return Response.json({ detail: 'This website may not place orders here.', code: 'origin_not_allowed' }, { status: 403 });
  const response = new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
  if (!origin) return response;
  const out = withCors(response, origin);
  out.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  out.headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
  out.headers.set('Access-Control-Max-Age', '600');
  return out;
}

// Every web order route: the origin check, errors as { detail, code }, CORS headers on every answer (errors included).
export function webRoute(handler: Handler): Handler {
  return async request => {
    const origin = allowedOrigin(request);
    let response: Response;
    try {
      if (origin === false) throw new HttpError(403, 'This website may not place orders here.', undefined, 'origin_not_allowed');
      response = await handler(request);
    } catch (error) {
      if (error instanceof HttpError) {
        const code = error.code ?? (error.status === 429 ? 'rate_limited' : undefined);
        response = Response.json(code ? { detail: error.detail, code } : { detail: error.detail }, { status: error.status, headers: error.headers });
      } else {
        console.error('[web-orders]', request.method, new URL(request.url).pathname, error instanceof Error ? error.message : 'error');
        response = Response.json({ detail: 'Something went wrong. Please try again.', code: 'server_error' }, { status: 500 });
      }
    }
    return withCors(response, origin || null);
  };
}

// ---------- Request shapes (a first, friendly check; the database checks everything again) ----------
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Not a valid id.');
const line = z.object({
  menu_item_id: uuid,
  qty: z.number({ message: 'Choose 1 to 20 of a dish.' }).int('Choose 1 to 20 of a dish.').min(1, 'Choose 1 to 20 of a dish.').max(20, 'Choose 1 to 20 of a dish.'),
  notes: z.string().max(140, 'A dish note can be up to 140 characters.').nullish(),
}).strict();
export const PlaceBody = z.object({
  store_link: z.string({ message: 'This restaurant page is not in use.' }).trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'This restaurant page is not in use.'),
  mode: z.enum(['dine_in', 'pickup'], { message: 'Choose dine-in or pickup.' }),
  table_session: z.string().regex(/^[0-9a-f]{64}$/, 'Please scan the table code again.').nullish(),
  pickup_at: z.string().min(10, 'Pick a pickup time.').max(40, 'Pick a pickup time.').nullish(),
  lines: z.array(line, { message: 'Add a dish first.' }).min(1, 'Add a dish first.').max(30, 'An order can have up to 30 different dishes.'),
  guest_name: z.string().max(40, 'A name can be up to 40 characters.').nullish(),
  phone: z.string().trim().regex(/^(\+?91[ -]?)?[6-9][0-9]{4}[ -]?[0-9]{5}$/, 'Enter a 10-digit mobile number.').nullish(),
  note: z.string().max(300, 'A note can be up to 300 characters.').nullish(),
  coupon_code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,20}$/, 'This discount code is not valid.').nullish(),
}).strict().superRefine((b, ctx) => {
  if (b.mode === 'dine_in' && !b.table_session) ctx.addIssue({ code: 'custom', message: 'Scan the table QR code to order to your table.', path: ['table_session'] });
  if (b.mode === 'pickup' && !b.pickup_at) ctx.addIssue({ code: 'custom', message: 'Pick a pickup time.', path: ['pickup_at'] });
  if (b.mode === 'pickup' && !b.phone) ctx.addIssue({ code: 'custom', message: 'Enter a 10-digit mobile number for pickup.', path: ['phone'] });
});
export const FindBody = z.union([
  z.object({ track: z.string().regex(/^[0-9a-f]{36}$/, 'This order link is not valid.') }).strict(),
  z.object({ order_id: uuid }).strict(),
], { message: 'Send the order link (track) or the order id.' });

async function parse<T extends z.ZodTypeAny>(request: Request, shape: T): Promise<z.infer<T>> {
  const text = await readText(request, 16 * 1024);
  let raw: unknown;
  try { raw = JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'Request body must be a JSON object', undefined, 'invalid_request'); }
  const r = shape.safeParse(raw);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'The request is not valid.', undefined, 'invalid_request');
  return r.data;
}

async function deviceHash(request: Request, required: boolean): Promise<string | null> {
  const key = customerKey(request);
  if (!key) {
    if (required) throw new HttpError(400, 'This device is not recognised; reload the page.', undefined, 'device_key_required');
    return null;
  }
  return sha256(key);
}

// ---------- Database errors the guest page can act on ----------
const ERRORS: Record<string, [number, string]> = {
  OL_BAD_REQUEST: [400, 'invalid_request'], OL_BAD_QTY: [400, 'invalid_request'], OL_EMPTY: [400, 'invalid_request'],
  OL_NOT_FOUND: [404, 'not_found'], OL_NOT_ONE_LOCAL: [404, 'not_one_local'], OL_NOT_PUBLISHED: [409, 'not_published'],
  OL_NOT_ACCEPTING: [409, 'not_accepting'], OL_ITEM_UNAVAILABLE: [409, 'item_unavailable'],
  OL_SESSION_EXPIRED: [409, 'session_expired'], OL_SESSION_MISMATCH: [409, 'session_mismatch'],
  OL_COUPON_UNKNOWN: [422, 'coupon_invalid'], OL_COUPON_MIN: [422, 'coupon_min_order'], OL_COUPON_LIMIT: [422, 'coupon_used_up'],
  OL_COUPON_CUSTOMER: [422, 'coupon_needs_phone'], OL_COUPON_ZERO: [422, 'coupon_invalid'],
  OL_BILL_NOT_YET: [409, 'bill_not_yet'], OL_WRONG_STATE: [409, 'wrong_state'],
  OL_IDEMPOTENCY_MISMATCH: [422, 'idempotency_mismatch'], OL_RATE_LIMITED: [429, 'rate_limited'],
};
const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s).replace(/([^.!?])$/, '$1.');

async function call(fn: string, p: Row): Promise<Row> {
  const { data, error } = await db().rpc(fn, { p });
  if (error) {
    const m = (error.message ?? '').match(/^(OL_[A-Z_]+):\s*(.*)$/);
    const known = m ? ERRORS[m[1]] : undefined;
    if (m && known) throw new HttpError(known[0], sentence(m[2]), undefined, known[1]);
    fromDbError(error);
  }
  return (data ?? {}) as Row;
}

// The restaurant hears about a new web order on its partner phones (the Orders board also shows it). Never fails the order.
async function tellRestaurant(order: Row) {
  try {
    const { data } = await db().from('ol_orders').select('organization_id, pos_order_id').eq('id', order.order_id).maybeSingle();
    if (!data?.organization_id || !data.pos_order_id) return;
    const where = order.mode === 'dine_in' ? `Table ${order.table_label}` : `Pickup ${new Date(order.pickup_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`;
    const items = (order.lines ?? []).reduce((n: number, l: Row) => n + (Number(l.qty) || 0), 0);
    await pushToRestaurant(data.organization_id, {
      title: `New web order ${order.display_no}`,
      body: `${where} · ${items} item${items === 1 ? '' : 's'} · ₹${Number(order.total).toFixed(0)} — accept it on the Orders board`,
      data: { type: 'new_order', order_id: data.pos_order_id, source: 'web' },
    });
  } catch (error) { console.warn('[web-orders] push', error instanceof Error ? error.message : 'error'); }
}

// ---------- The three calls ----------
export async function placeWebOrder(request: Request): Promise<Response> {
  // Limits before anything is read: per device and per network address (guests at one restaurant share its Wi-Fi).
  await limitCaller(request, 'web-order-place', 6, 60_000, { verify: false, anonIpMax: 60 });
  const hash = await deviceHash(request, true);
  const key = idempotencyKey(request);
  if (!key) throw new HttpError(400, 'Idempotency-Key header is required.', undefined, 'invalid_request');
  const body = await parse(request, PlaceBody);
  const order = await call('ol_web_order_place', { ...body, customer_hash: hash, idempotency_key: key });
  if (order.replayed === false) await tellRestaurant(order);
  return Response.json(order);
}

export async function webOrderStatus(request: Request): Promise<Response> {
  await limitCaller(request, 'web-order-status', 120, 60_000, { verify: false, anonIpMax: 1200 });
  const body = await parse(request, FindBody);
  const hash = 'order_id' in body ? await deviceHash(request, true) : null;
  return Response.json(await call('ol_web_order_status', { ...body, customer_hash: hash }));
}

export async function askWebOrderBill(request: Request): Promise<Response> {
  await limitCaller(request, 'web-order-bill', 10, 60_000, { verify: false, anonIpMax: 120 });
  const body = await parse(request, FindBody);
  const hash = 'order_id' in body ? await deviceHash(request, true) : null;
  return Response.json(await call('ol_web_order_bill', { ...body, customer_hash: hash }));
}
