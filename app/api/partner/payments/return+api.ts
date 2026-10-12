// Where Cashfree sends the payer's browser when its window finishes. It shows no state and trusts nothing: the app asks
// GET /api/partner/payments/online/{attempt_id} for the answer.
export const GET = () => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment</title><body style="font-family:system-ui;padding:2rem;text-align:center"><p>You can close this window and go back to the app.</p></body>',
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
