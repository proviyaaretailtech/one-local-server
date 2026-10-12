import { json, route } from '../../../server/http';
import { paymentMethods } from '../../../server/cashfree-checkout';

// What the payment screen can offer right now: provider, cash on delivery (with the reason when not), UPI apps, cards, netbanking, wallets.
export const GET = route(async request => json(await paymentMethods(request)));
