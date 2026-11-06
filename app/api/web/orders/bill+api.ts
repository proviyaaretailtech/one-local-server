import { askWebOrderBill, webPreflight, webRoute } from '../../../../server/web-orders';

// The guest asks for the bill once every dish is ready or served; answers the status with the bill.
export const POST = webRoute(askWebOrderBill);
export const OPTIONS = webPreflight;
