// Which customer-facing features are live. Today each switches on by itself once the key it needs
// is configured; FEATURE_<NAME>=on|off in the environment overrides that (for demos and rollbacks).
// Next step (docs/MASTER_ADMIN_HANDSHAKE.md): these rows move into ol_feature_flags so the Master
// Admin can switch a feature on or off per city without a deploy — this function becomes the
// reader of that table, and the app keeps calling GET /api/features unchanged.
export type Features = {
  ai_search: boolean;        // photo + voice search
  assistant: boolean;        // One AI shopping assistant
  maps: boolean;             // Google Maps pin-drop and address search
  online_payments: boolean;  // UPI / card / net banking (Cashfree, else Razorpay)
  wallet: boolean;           // OneLocal Wallet
  coins: boolean;            // OneLocal Coins
  google_sign_in: boolean;   // mirrors Supabase's own setting; the app also asks Supabase directly
};

const has = (...keys: string[]) => keys.some(k => !!process.env[k]?.trim());
const override = (name: string, fallback: boolean) => {
  const v = process.env[`FEATURE_${name.toUpperCase()}`]?.trim().toLowerCase();
  return v === 'on' ? true : v === 'off' ? false : fallback;
};

export function features(): Features {
  const ai = has('ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'EMERGENT_LLM_KEY');
  return {
    ai_search: override('ai_search', ai),
    assistant: override('assistant', ai),
    maps: override('maps', has('GOOGLE_MAPS_API_KEY')),
    online_payments: override('online_payments', (has('CASHFREE_PG_APP_ID') && has('CASHFREE_PG_SECRET_KEY')) || (has('RAZORPAY_KEY_ID') && has('RAZORPAY_KEY_SECRET'))),
    wallet: override('wallet', false),
    coins: override('coins', false),
    google_sign_in: override('google_sign_in', false),
  };
}
