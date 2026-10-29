// Run: npx tsx scripts/coming-soon-checks.ts
// The coming-soon build blocks writes, but a person's own data rights (erasure, consent, grievance, nominee)
// must stay open: Google Play and the DPDP Act both require account deletion to work.
import assert from 'node:assert/strict';
import { isAlwaysOpenApi, isComingSoonRoute } from '../src/coming-soon-mode';

let passed = 0;
const ok = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`ok    ${name}`); };

ok('account erasure is never blocked', () => assert.equal(isAlwaysOpenApi('/privacy/erasure'), true));
ok('consent, grievance and nominee calls are never blocked', () => {
  for (const p of ['/privacy/consents', '/privacy/grievances', '/privacy/nominee']) assert.equal(isAlwaysOpenApi(p), true, p);
});
ok('carts, orders and profile edits are still blocked', () => {
  for (const p of ['/cart', '/orders', '/checkouts', '/customer/profile', '/privacyx', '/orders/privacy/1']) assert.equal(isAlwaysOpenApi(p), false, p);
});
ok('store pages still show the coming-soon page, tabs and sign-in stay open', () => {
  assert.equal(isComingSoonRoute(['store', '[id]']), true);
  assert.equal(isComingSoonRoute(['(tabs)', 'account']), false);
  assert.equal(isComingSoonRoute(['sign-in']), false);
});
console.log(`\n${passed} checks passed.`);
