// Push alerts through Expo's push service (Expo → Firebase on Android / Apple on iOS).
// Needs no server secret. Tokens Expo reports as unregistered are removed.
import { db } from './db';

type Message = { title: string; body: string; data: Record<string, unknown> };

export async function pushToRestaurant(organizationId: string, message: Message) {
  try {
    const { data } = await db().from('ol_partner_devices').select('expo_push_token').eq('organization_id', organizationId);
    const tokens = (data ?? []).map(d => d.expo_push_token as string).filter(t => /^Expo(nent)?PushToken\[/.test(t));
    if (!tokens.length) return { sent: 0 };
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokens.map(to => ({
        to, title: message.title, body: message.body, data: message.data,
        sound: 'new_order.wav', channelId: 'new-orders', priority: 'high', interruptionLevel: 'time-sensitive', ttl: 60,
      }))),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json().catch(() => ({}));
    const tickets: { status: string; details?: { error?: string } }[] = result.data ?? [];
    const dead = tokens.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
    if (dead.length) await db().from('ol_partner_devices').delete().in('expo_push_token', dead);
    return { sent: tickets.filter(t => t.status === 'ok').length };
  } catch (error) {
    // An alert that fails to send must never break the order itself; phones also poll.
    console.warn('[push]', error);
    return { sent: 0 };
  }
}

// A job offer (or a cancellation) on a rider's phone. Same service as the restaurant alerts, but a
// short life: an offer is worth ringing for about 30 seconds, so Expo drops the push after that.
export async function pushToRider(riderId: string, message: Message & { sound?: boolean }) {
  try {
    const { data } = await db().from('push_tokens').select('expo_push_token').eq('rider_id', riderId);
    const tokens = (data ?? []).map(d => d.expo_push_token as string).filter(t => /^Expo(nent)?PushToken\[/.test(t));
    if (!tokens.length) return { sent: 0 };
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokens.map(to => ({
        to, title: message.title, body: message.body, data: message.data,
        ...(message.sound === false ? {} : { sound: 'job_offer.wav' }), channelId: 'job-offers', priority: 'high', interruptionLevel: 'time-sensitive', ttl: 30,
      }))),
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json().catch(() => ({}));
    const tickets: { status: string; details?: { error?: string } }[] = result.data ?? [];
    const dead = tokens.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
    if (dead.length) await db().from('push_tokens').delete().in('expo_push_token', dead);
    return { sent: tickets.filter(t => t.status === 'ok').length };
  } catch (error) {
    // The rider app also polls for its offer, so a push that fails to send never breaks dispatch.
    console.warn('[push:rider]', error);
    return { sent: 0 };
  }
}

// An order update on the customer's phone, through the customer device registry (ol_customer_devices, migration 0234).
// The caller must be a signed-in customer (ol_orders.user_id). An explicit withdrawal of the push channel in ol_consent_current
// (granted = false) stops every push: checked here so the answer says 'opted_out', and again inside ol_customer_push_targets so no other caller can skip it.
// Order updates are transactional, so they do not need the marketing opt-in, only the absence of an opt-out.
// Tokens Expo reports as DeviceNotRegistered are revoked in the registry.
export async function pushToCustomer(userId: string | null, message: Message): Promise<{ sent: number; skipped?: 'no_account' | 'opted_out' | 'no_devices' }> {
  if (!userId) return { sent: 0, skipped: 'no_account' };
  try {
    const { data: withdrawn } = await db().from('ol_consent_current').select('granted').eq('user_id', userId).eq('channel', 'push').eq('granted', false).limit(1);
    if (withdrawn?.length) return { sent: 0, skipped: 'opted_out' };
    const { data } = await db().rpc('ol_customer_push_targets', { p_user: userId });
    const tokens = ((data ?? []) as { expo_push_token: string }[]).map(d => d.expo_push_token).filter(t => /^Expo(nent)?PushToken\[/.test(t));
    if (!tokens.length) return { sent: 0, skipped: 'no_devices' };
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokens.map(to => ({ to, title: message.title, body: message.body, data: message.data, sound: 'default', priority: 'high', ttl: 3600 }))),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json().catch(() => ({}));
    const tickets: { status: string; details?: { error?: string } }[] = result.data ?? [];
    const dead = tokens.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
    if (dead.length) await db().rpc('ol_customer_device_revoke_tokens', { p_tokens: dead });
    return { sent: tickets.filter(t => t.status === 'ok').length };
  } catch (error) {
    // An alert that fails to send must never break the order itself; the order screen also polls.
    console.warn('[push:customer]', error);
    return { sent: 0 };
  }
}

// Register / revoke a customer's phone (called by /api/customer/devices once the customer is signed in).
export async function registerCustomerDevice(userId: string, token: string, platform: string, locale?: string | null) {
  const { data, error } = await db().rpc('ol_customer_device_register', { p_user: userId, p_token: token, p_platform: platform, p_locale: locale ?? null });
  if (error) throw error;
  return data as string;
}
export async function revokeCustomerDevice(userId: string, token?: string | null) {
  const { data, error } = await db().rpc('ol_customer_device_revoke', { p_user: userId, p_token: token ?? null });
  if (error) throw error;
  return Number(data ?? 0);
}
