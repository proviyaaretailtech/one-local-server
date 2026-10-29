// What a customer may send when rating an order or reporting a problem with an item (server/order-feedback.ts). Pure: no database.
// Everything is checked here, on the server: the app's own checks are for the customer's convenience, not for safety.
import { HttpError } from './http';

export const ISSUE_KINDS = ['missing', 'wrong', 'damaged', 'quality'] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];
export const MAX_TEXT = 500;
export const MAX_OPEN_ISSUES_PER_ORDER = 10;

const bad = (message: string, code: string) => new HttpError(400, message, undefined, code);
const stars = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5 ? (v as number) : NaN);
const text = (v: unknown, code: string): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw bad('Text must be a string.', code);
  const t = v.replace(/\s+/g, ' ').trim();
  if (t.length > MAX_TEXT) throw bad(`Please keep it under ${MAX_TEXT} characters.`, code);
  return t || null;
};
const body = (b: unknown, code: string): Record<string, unknown> => {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('Request body must be a JSON object.', code);
  return b as Record<string, unknown>;
};

export function parseRating(raw: unknown): { rating: number; delivery_rating: number | null; comment: string | null } {
  const b = body(raw, 'invalid_rating');
  const rating = stars(b.rating); const delivery = stars(b.delivery_rating);
  if (rating === null || Number.isNaN(rating)) throw bad('Please give 1 to 5 stars.', 'invalid_rating');
  if (Number.isNaN(delivery)) throw bad('Delivery stars must be 1 to 5.', 'invalid_rating');
  return { rating, delivery_rating: delivery, comment: text(b.comment, 'invalid_rating') };
}

/** `items` = the order's own items (id, qty): a report can only name an item of this order, and never more pieces than were bought. */
export function parseIssue(raw: unknown, items: readonly { id: string; qty: number }[]): { order_item_id: string; kind: IssueKind; qty: number; note: string | null } {
  const b = body(raw, 'invalid_issue');
  if (!ISSUE_KINDS.includes(b.kind as IssueKind)) throw bad('Please say what went wrong.', 'invalid_issue');
  const item = items.find(i => i.id === b.order_item_id);
  if (!item) throw bad('Please choose one of the items in this order.', 'invalid_issue');
  const qty = b.qty === undefined || b.qty === null ? 1 : b.qty;
  if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > item.qty) throw bad(`Quantity must be 1 to ${item.qty}.`, 'invalid_issue');
  return { order_item_id: item.id, kind: b.kind as IssueKind, qty, note: text(b.note, 'invalid_issue') };
}
