// Web: Razorpay's own Checkout script opens its payment window over the page. Card numbers, UPI PINs
// and bank logins are typed there, never into One Local. The phone app uses razorpay-checkout.tsx.
import { useEffect } from 'react';
import { PaymentResult, PaymentStart } from '../api';

type RazorpayInstance = { open: () => void; on: (event: string, cb: (r: { error?: { description?: string } }) => void) => void };
declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance } }

let script: Promise<void> | null = null;
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return (script ??= new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = 'https://checkout.razorpay.com/v1/checkout.js';
    tag.onload = () => resolve();
    tag.onerror = () => { script = null; reject(new Error('Could not load the payment page')); }; // i18n-ignore: developer reason, never shown
    document.body.appendChild(tag);
  }));
}

// The `reason` texts in the results below are for developers (the cart never shows them), so they stay English.
export function RazorpayCheckout({ session, onResult }: { session: PaymentStart; method: string; app?: string; onResult: (r: PaymentResult) => void }) {
  useEffect(() => {
    let done = false, failure = '';
    const finish = (r: PaymentResult) => { if (!done) { done = true; onResult(r); } };
    const open = (withConfig: boolean) => {
      const options: Record<string, unknown> = {
        ...session.checkout, prefill: session.prefill,
        handler: (r: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => finish({ type: 'success', ...r }),
        modal: { confirm_close: true, ondismiss: () => finish(failure ? { type: 'failed', reason: failure } : { type: 'dismiss' }) },
      };
      if (!withConfig) delete options.config;
      const rzp = new window.Razorpay!(options);
      // Razorpay keeps its window open after a failed attempt so the customer can retry there.
      rzp.on('payment.failed', r => { failure = r?.error?.description || 'Payment failed'; });
      rzp.open();
    };
    loadCheckout().then(() => {
      // If Razorpay rejects the method shortcut, open its full page instead.
      try { open(true); } catch { open(false); }
    }).catch(() => finish({ type: 'failed', reason: 'Could not load the payment page' }));
    // Opened once per session; onResult is read at the moment Razorpay answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
  return null;
}
