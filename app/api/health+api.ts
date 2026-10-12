import { json, route } from '../../server/http';
import { outboxStuckCount } from '../../server/outbox';

// Liveness, plus one number: how many queued events have been waiting too long (null = database not reachable from here). No payloads.
export const GET = route(async () => json({ status: 'ok', time: new Date().toISOString(), outbox_stuck: await outboxStuckCount() }));
