import { limit, json, readBody, route } from '../../../server/http';
import { registerPushToken, requireRider } from '../../../server/rider';
import { unregisterPushToken } from '../../../server/rider-push';

export const PUT = route(async request => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-push-token', 10, 60_000);
  return json(await registerPushToken(rider, await readBody(request)));
});

// Sign-out: stop alerts to this phone ({ expo_push_token }) or to every phone ({ all: true }).
export const DELETE = route(async request => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-push-token', 10, 60_000);
  return json(await unregisterPushToken(rider, await readBody(request)));
});
