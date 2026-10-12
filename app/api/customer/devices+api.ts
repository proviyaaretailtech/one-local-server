import { signedInUserId } from '../../../server/auth';
import { HttpError, json, limit, readBody, route } from '../../../server/http';
import { registerCustomerDevice, revokeCustomerDevice } from '../../../server/push';

// The signed-in customer's phones for order-update pushes (ol_customer_devices, migration 0234).
// PUT { expo_push_token, platform: 'ios'|'android'|'web', locale? }  register / refresh this phone (call at launch after sign-in).
// DELETE { expo_push_token } stop alerts to this phone, or { all: true } to every phone (call on sign-out).
async function customer(request: Request) {
  const userId = await signedInUserId(request);
  if (!userId) throw new HttpError(401, 'Please sign in to get order updates on this phone.');
  limit(userId, 'customer-devices', 10, 60_000);
  return userId;
}

export const PUT = route(async request => {
  const userId = await customer(request);
  const body = await readBody(request);
  const token = typeof body.expo_push_token === 'string' ? body.expo_push_token.trim() : '';
  const platform = typeof body.platform === 'string' ? body.platform : '';
  if (!/^Expo(nent)?PushToken\[.{1,200}\]$/.test(token) || !['ios', 'android', 'web'].includes(platform)) throw new HttpError(422, 'That phone cannot be registered for alerts.');
  const locale = typeof body.locale === 'string' ? body.locale.trim().slice(0, 20) : null;
  await registerCustomerDevice(userId, token, platform, locale);
  return json({ ok: true });
});

export const DELETE = route(async request => {
  const userId = await customer(request);
  const body = await readBody(request);
  const token = typeof body.expo_push_token === 'string' ? body.expo_push_token.trim() : '';
  if (!token && body.all !== true) throw new HttpError(422, 'Say which phone to stop alerts on, or all: true.');
  return json({ revoked: await revokeCustomerDevice(userId, body.all === true ? null : token) });
});
