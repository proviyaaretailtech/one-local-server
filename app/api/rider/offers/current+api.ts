import { json, limit, route } from '../../../../server/http';
import { currentOffer, requireRider } from '../../../../server/rider';

// Polled every 5 seconds while the app is open; 204 when there is no live offer.
export const GET = route(async request => {
  const rider = await requireRider(request);
  limit(rider.id, 'rider-offer', 30, 60_000);
  const offer = await currentOffer(rider);
  return offer ? json(offer) : new Response(null, { status: 204 });
});
