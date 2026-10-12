// onecity://payment-result?checkout_id=<id>&status=<paid|pending|failed> — where Cashfree's result page sends the customer
// back to the app (docs/PAYMENTS.md, "Open the hosted page"). The link is only a cue: the cart screen finds the payment that
// was left open (src/payments/api.ts readInFlight) and asks the server what happened. Nothing here decides paid or failed.
import { Redirect } from 'expo-router';

export default function PaymentResult() {
  return <Redirect href="/(tabs)/cart" />;
}
