// A customer rating their delivered order, and reporting a problem with an item of it (tables: db/migrations/0030, a DRAFT).
// Who is asking is checked here (the order must be theirs, ownOrder), and so are the limits. A report only opens a case: it never
// moves money. Operations approve it, and any refund then goes through the refund queue (server/refunds.ts) with its own guards.
// Until the migration is applied the tables do not exist: every answer is then 503 feedback_unavailable and the app hides these parts.
import { caller } from './auth';
import { ownOrder } from './customer-cancel';
import { db, fromDbError } from './db';
import { HttpError } from './http';
import { limitCaller } from './limits';
import { MAX_OPEN_ISSUES_PER_ORDER, parseIssue, parseRating } from './order-feedback-rules';

type DbError = { message?: string; code?: string } | null;
const unavailable = () => new HttpError(503, 'Feedback is not available yet.', undefined, 'feedback_unavailable');
// A table that is not there (migration not applied): Postgres 42P01, or PostgREST PGRST205 "not found in the schema cache".
const check = (error: DbError) => {
  if (!error) return;
  if (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '')) throw unavailable();
  fromDbError(error);
};
const delivered = (order: Record<string, unknown>) => {
  if (order.status !== 'delivered') throw new HttpError(409, 'You can do this once the order is delivered.', undefined, 'not_delivered');
};
async function readBody(request: Request) { try { return await request.json(); } catch { throw new HttpError(400, 'Request body must be JSON.', undefined, 'invalid_body'); } }

export async function getOrderFeedback(request: Request, id: string) {
  await ownOrder(request, id);
  const [rating, issues] = await Promise.all([
    db().from('ol_order_ratings').select('rating, delivery_rating, comment, created_at').eq('order_id', id).maybeSingle(),
    db().from('ol_order_issues').select('id, order_item_id, kind, qty, note, status, created_at').eq('order_id', id).order('created_at', { ascending: false }),
  ]);
  check(rating.error); check(issues.error);
  return { rating: rating.data ?? null, issues: issues.data ?? [] };
}

export async function rateOrder(request: Request, id: string) {
  const order = await ownOrder(request, id); delivered(order);
  await limitCaller(request, 'order-rating', 20, 60 * 60 * 1000);
  const input = parseRating(await readBody(request));
  const { userId } = await caller(request);
  const { error } = await db().from('ol_order_ratings').insert({ order_id: id, customer_hash: order.customer_hash, user_id: userId, ...input });
  if (error?.code === '23505') throw new HttpError(409, 'You have already rated this order.', undefined, 'already_rated');
  check(error);
  return { ok: true };
}

export async function reportIssue(request: Request, id: string) {
  const order = await ownOrder(request, id); delivered(order);
  await limitCaller(request, 'order-issue', 20, 60 * 60 * 1000);
  const { data: items, error: itemsError } = await db().from('ol_order_items').select('id, qty').eq('order_id', id);
  if (itemsError) fromDbError(itemsError);
  const input = parseIssue(await readBody(request), (items ?? []).map(i => ({ id: String(i.id), qty: Number(i.qty) })));
  const { count, error: countError } = await db().from('ol_order_issues').select('id', { count: 'exact', head: true }).eq('order_id', id).eq('status', 'open');
  check(countError);
  if ((count ?? 0) >= MAX_OPEN_ISSUES_PER_ORDER) throw new HttpError(409, 'This order already has several open reports. We are looking at them.', undefined, 'too_many_issues');
  const { userId } = await caller(request);
  const { data, error } = await db().from('ol_order_issues').insert({ order_id: id, customer_hash: order.customer_hash, user_id: userId, ...input }).select('id, status').single();
  if (error?.code === '23505') throw new HttpError(409, 'You have already reported this. We are looking at it.', undefined, 'already_reported');
  check(error);
  return data;
}
