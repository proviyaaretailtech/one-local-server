import { require, requirePartnerAuth } from '@/server/partner';
import { act } from '@/server/restaurant';
import { route, readBody } from '@/server/http';
import { idempotent } from '@/server/idempotency';

export const POST = route(async (request, params) => {
  const staff = await requirePartnerAuth(request);
  require(staff, 'ready');
  // Idempotency-Key (optional): a retried tap replays the first answer instead of hitting a changed order version.
  return idempotent(request, `partner:${staff.organizationId}:${staff.userId}`, async () => act(staff, params?.id ?? '', 'ready', await readBody(request)));
});
