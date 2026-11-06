import { masterKeyConfigured } from '../../server/admin';
import { json, route } from '../../server/http';
import { masterStatus } from '../../server/master-client';
import { outboxStuckCount } from '../../server/outbox';

// Liveness, plus one number: how many queued events have been waiting too long (null = database not reachable from here). No payloads.
// `master` says whether the Master server answers to each of our keys: ok / wrong_key / unreachable / not_configured.
// Those checks run side by side with a short timeout and are remembered for 30 s, so liveness stays fast.
// `master_key_configured` says whether the admin API asks the Master server for its own key (INTERNAL_KEY_MASTER); never the value.
export const GET = route(async () => {
  const [outbox_stuck, customer, partner] = await Promise.all([outboxStuckCount(), masterStatus('customer'), masterStatus('partner')]);
  return json({ status: 'ok', time: new Date().toISOString(), outbox_stuck, master: { customer, partner }, master_key_configured: masterKeyConfigured() });
});
