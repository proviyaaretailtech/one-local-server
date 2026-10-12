// Rider push-token revoke (DELETE /rider/push-token). Kept apart from rider.ts, which registers the token (PUT).
import { db, fromDbError } from './db';
import { HttpError } from './http';
import type { Rider } from './rider';

type Row = Record<string, unknown>;

// Sign-out on one phone: drop that phone's token only ({ expo_push_token }), so the rider's other phones keep
// ringing. Sign-out of every device: { all: true } drops every token of the rider. Both are scoped to the signed-in
// rider and idempotent: a token already gone (or never registered) is still ok, so a retried sign-out never fails.
export async function unregisterPushToken(rider: Rider, b: Row) {
  if (b.all === true) {
    const { error } = await db().from('push_tokens').delete().eq('rider_id', rider.id);
    if (error) fromDbError(error);
    return { ok: true };
  }
  const token = String(b.expo_push_token ?? '');
  if (!/^Expo(nent)?PushToken\[[^\]]{4,200}\]$/.test(token)) throw new HttpError(400, 'Invalid device registration.', undefined, 'validation');
  const { error } = await db().from('push_tokens').delete().eq('rider_id', rider.id).eq('expo_push_token', token);
  if (error) fromDbError(error);
  return { ok: true };
}
