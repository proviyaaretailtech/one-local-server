import { placeWebOrder, webPreflight, webRoute } from '../../../server/web-orders';

// A guest on a restaurant's own page places a dine-in or pickup order (spec-part2-live-orders contract A). Idempotency-Key required.
export const POST = webRoute(placeWebOrder);
export const OPTIONS = webPreflight;
