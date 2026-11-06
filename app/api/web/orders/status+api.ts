import { webOrderStatus, webPreflight, webRoute } from '../../../../server/web-orders';

// Where a web order is: by its tracking link, or by its id with the same device key.
export const POST = webRoute(webOrderStatus);
export const OPTIONS = webPreflight;
