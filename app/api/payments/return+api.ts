import { route } from '../../../server/http';
import { returnPage } from '../../../server/cashfree-checkout';

// Where Cashfree sends the customer back to: a plain result page that tells the app (or the web page that opened it) to ask for the status.
export const GET = route(request => returnPage(request));
