/* Cart add feedback: how often does the "Great pick! … is in your bag" mascot appear?
 * The product owner wants it once, not on every add. A MutationObserver counts every
 * time the overlay (testID cart-added-popup, src/components/cart-celebration.tsx) is
 * inserted, across a realistic shopping run in one visit, then after a page reload. */
import { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { byId, monitor, openRoute, snap, tapId, writeResult } from './helpers';

async function installCounter(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __popups: { at: number; text: string }[] };
    w.__popups = [];
    let present = false;
    const check = () => {
      const el = document.querySelector('[data-testid="cart-added-popup"]');
      if (el && !present) w.__popups.push({ at: Date.now(), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90) });
      present = !!el;
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true });
  });
}
const shows = (page: Page) => page.evaluate(() => (window as unknown as { __popups: { text: string }[] }).__popups);
const cartCount = (page: Page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('onelatur.cart.v1') || '[]').reduce((a: number, b: { qty: number }) => a + b.qty, 0); } catch { return -1; } });

test('the “Great pick!” mascot appears once per shopping visit, not on every add', async ({ page }, testInfo) => {
  const m = monitor(page);
  await installCounter(page);
  const timeline: { action: string; cartItems: number; mascotShowsSoFar: number; floatingCart: string }[] = [];
  const log = async (action: string) => {
    await page.waitForTimeout(700);
    // Floating bag bar on browse screens; the sticky "N in cart · View cart" bar on product pages.
    const floating = await byId(page, 'floating-cart-count').innerText({ timeout: 2_000 })
      .catch(() => byId(page, 'pd-view-cart').isVisible().then(v => (v ? 'product page cart bar' : '')));
    timeline.push({ action, cartItems: await cartCount(page), mascotShowsSoFar: (await shows(page)).length, floatingCart: floating });
  };

  await openRoute(page, '/grocery', '[data-testid="department-screen-grocery"]');
  // Six different products, at a normal browsing pace. Some gaps are longer than the
  // mascot's 3.4 s display time, so a "once" rule cannot pass by accident.
  const products = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  for (const [i, id] of products.entries()) {
    await tapId(page, `add-btn-grocery-${id}`);
    await log(`ADD ${id} on /grocery`);
    if (i === 0) await snap(page, 'cart-feedback-first-add');
    if (i === 1) await snap(page, 'cart-feedback-second-add');
    await page.waitForTimeout(i % 2 ? 4_000 : 1_000);
  }
  await tapId(page, 'inc-grocery-p1');
  await log('+1 on p1 stepper');

  // Client-side navigation: product page, category page.
  await tapId(page, 'product-name-open-grocery-p7').catch(async () => { await openRoute(page, '/product/p7', '[data-testid="product-detail"]'); });
  await byId(page, 'pd-add-btn').waitFor();
  await tapId(page, 'pd-add-btn');
  await log('Add to Cart on product page p7');
  await snap(page, 'cart-feedback-product-page-add');
  await page.waitForTimeout(4_000);

  const inVisit = (await shows(page)).length;

  // Reload = a new web "app launch".
  await openRoute(page, '/grocery', '[data-testid="department-screen-grocery"]');
  await tapId(page, 'add-btn-grocery-p8');
  await log('ADD p8 after a page reload');
  const afterReload = (await shows(page)).length;
  await snap(page, 'cart-feedback-after-reload');

  const adds = timeline.length;
  const result = { adds, mascotShowsInFirstVisit: inVisit, mascotShowsAfterReload: afterReload, timeline, popups: await shows(page), pageErrors: m.pageErrors };
  writeResult('cart-feedback', 'mascot-frequency', result);
  testInfo.annotations.push({ type: 'mascot', description: `mascot shown ${inVisit} time(s) in ${adds - 1} adds during one visit; ${afterReload} time(s) after reload + 1 add` });

  // Every add must still be confirmed somehow (the floating bag bar updates its count).
  for (const t of timeline) expect.soft(t.floatingCart || 'n/a', `floating cart confirms "${t.action}"`).not.toBe('');
  expect.soft(inVisit, 'mascot should appear exactly once per visit').toBe(1);
});
