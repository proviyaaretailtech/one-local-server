import { adminRoute, audit, preflight, requireAdmin } from '../../../../server/admin';
import { HttpError, json, readBody } from '../../../../server/http';
import { decideHold } from '../../../../server/order-risk';

// POST { decision: 'release' | 'reject', note? }: release sends the order to its restaurant, reject cancels (and refunds) it.
export const POST = adminRoute(async (request, { id }) => {
  const admin = await requireAdmin(request, true);
  const body = await readBody<{ decision?: unknown; note?: unknown }>(request);
  if (body.decision !== 'release' && body.decision !== 'reject') throw new HttpError(400, 'decision must be release or reject');
  if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) throw new HttpError(400, 'Unknown hold.');
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null;
  const result = await decideHold(id, body.decision, admin.userId, note);
  audit(admin, `order_holds.${body.decision}`, id, { order: result.order_id });
  return json(result);
});
export const OPTIONS = preflight;
