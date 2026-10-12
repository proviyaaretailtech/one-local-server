import { route } from '../../../server/http';
import { checkoutPage as cashfreePage } from '../../../server/cashfree-checkout';
import { activeProvider } from '../../../server/payment-provider';
import { checkoutPage } from '../../../server/payments';

// The page the phone app's WebView (or a web tab) opens: Cashfree's checkout for one of the caller's own checkouts, or Razorpay's when Cashfree is off.
export const GET = route(request => (activeProvider()?.name === 'cashfree' ? cashfreePage(request) : checkoutPage(request)));
