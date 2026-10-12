/* Core customer journeys, end to end, the way a person taps through them.
 * A failing step is a finding: it is kept, not worked around. Each journey writes
 * e2e/results/journeys/<name>.json (steps, pass/fail, screenshots, errors). */
import { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import { byId, monitor, openRoute, realConsoleErrors, scrollMain, snap, tapId, unexpectedApi, blockedApi, writeResult, Monitor } from './helpers';

type Step = { name: string; ok: boolean; error?: string; shot?: string; ms: number };

function journey(name: string, page: Page, m: Monitor, testInfo: TestInfo) {
  const steps: Step[] = [];
  let n = 0;
  return {
    steps,
    async step(label: string, fn: () => Promise<void>) {
      const t0 = Date.now(); n++;
      const shotName = `journey-${name}-${String(n).padStart(2, '0')}`;
      try {
        await test.step(label, fn);
        steps.push({ name: label, ok: true, ms: Date.now() - t0, shot: await snap(page, shotName).catch(() => undefined) });
      } catch (e) {
        steps.push({ name: label, ok: false, error: (e as Error).message.split('\n').slice(0, 6).join(' | ').slice(0, 700), ms: Date.now() - t0, shot: await snap(page, `${shotName}-FAILED`).catch(() => undefined) });
        this.save();
        throw e;
      }
    },
    save() {
      writeResult('journeys', name, { journey: name, title: testInfo.title, passed: steps.every(s => s.ok), steps, consoleErrors: realConsoleErrors(m), pageErrors: m.pageErrors, apiFailures: unexpectedApi(m), apiBlocked: blockedApi(m) });
    },
  };
}

test.describe.configure({ mode: 'parallel' });

test('shop: home → department → category → product → cart → LATUR10 → order → tracking → My orders', async ({ page }, testInfo) => {
  const m = monitor(page); const j = journey('checkout', page, m, testInfo);
  let orderId = ''; let totalBefore = 0; let totalTimeline: string[] = [];
  const money = (t: string) => Number(t.replace(/[^\d.]/g, ''));
  await j.step('open home', async () => { await openRoute(page, '/', '[data-testid="home-screen"]'); });
  await j.step('tap the Groceries department', async () => {
    await tapId(page, 'department-grocery');
    await expect(page).toHaveURL(/\/grocery$/);
    await expect(byId(page, 'department-screen-grocery')).toBeVisible();
  });
  await j.step('tap the Fruits & Veggies category', async () => {
    await tapId(page, 'grocery-page-category-c1');
    await expect(page).toHaveURL(/\/category\/c1$/);
    await expect(byId(page, 'category-title')).toHaveText(/Fruits/);
  });
  await j.step('open the Fresh Tomatoes product page', async () => {
    await tapId(page, 'category-product-name-open-p1');
    await expect(page).toHaveURL(/\/product\/p1$/);
    await expect(byId(page, 'pd-add-btn')).toBeVisible();
  });
  await j.step('add to cart and raise the quantity to 5', async () => {
    await tapId(page, 'pd-add-btn');
    await expect(byId(page, 'pd-inc')).toBeVisible();
    for (let i = 0; i < 4; i++) await tapId(page, 'pd-inc');
    // Wording differs between versions of the product page ("5 in cart" / "5 in bag").
    await expect(page.getByText(/^5 in (cart|bag)/).filter({ visible: true }).first()).toBeVisible();
  });
  await j.step('open the cart from the product page', async () => {
    await tapId(page, 'pd-view-cart');
    await expect(page).toHaveURL(/\/cart$/);
    await expect(byId(page, 'checkout-total')).toHaveText(/₹\d/);
    // Record what the total shows while the bill loads, then use the settled value.
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) { seen.push(await byId(page, 'checkout-total').innerText()); await page.waitForTimeout(400); }
    totalTimeline = [...new Set(seen)];
    totalBefore = money(seen[seen.length - 1]);
    testInfo.annotations.push({ type: 'cart total while loading', description: totalTimeline.join(' → ') });
    expect(totalBefore).toBeGreaterThanOrEqual(125); // 5 × ₹25, plus any fees
  });
  await j.step('apply coupon LATUR10', async () => {
    await byId(page, 'coupon-input').fill('LATUR10');
    await tapId(page, 'apply-coupon-btn');
    await expect(byId(page, 'applied-coupon')).toContainText('LATUR10');
    await expect.poll(async () => money(await byId(page, 'checkout-total').innerText())).toBeLessThan(totalBefore);
    await expect(page.getByText(/Coupon LATUR10/).filter({ visible: true }).first()).toBeVisible();
  });
  await j.step('place the sample order', async () => {
    await tapId(page, 'checkout-btn');
    await expect(page).toHaveURL(/\/order\/[^/]+$/, { timeout: 30_000 });
    orderId = page.url().split('/order/')[1];
    await expect(byId(page, 'tracking-title')).toBeVisible();
  });
  await j.step('order tracking shows the order and the cart is now empty', async () => {
    await expect(byId(page, 'order-tracking')).toContainText(/Fresh Tomatoes/);
    await expect(byId(page, 'header-cart-count')).toHaveCount(0);
  });
  await j.step('reach My orders through the app (Home → profile → My Orders)', async () => {
    await tapId(page, 'tab-home');
    await expect(byId(page, 'home-screen')).toBeVisible();
    await scrollMain(page, 'top');
    await tapId(page, 'header-profile-btn');
    await tapId(page, 'acc-orders');
    await expect(page).toHaveURL(/\/orders$/);
    await expect(byId(page, `order-${orderId}`)).toBeVisible();
  });
  await j.step('track the order again from My orders', async () => {
    await tapId(page, `track-${orderId}`);
    await expect(page).toHaveURL(new RegExp(`/order/${orderId}$`));
  });
  j.save();
  writeResult('checkout-total', 'timeline', { totalTimeline });
});

test('search by text from the home header', async ({ page }, testInfo) => {
  const m = monitor(page); const j = journey('search', page, m, testInfo);
  await j.step('open home', async () => { await openRoute(page, '/', '[data-testid="home-screen"]'); });
  await j.step('tap the search bar', async () => {
    await tapId(page, 'header-search-button');
    await expect(page).toHaveURL(/\/search/);
    await expect(byId(page, 'search-input')).toBeFocused();
  });
  await j.step('type "milk" and get results', async () => {
    await byId(page, 'search-input').fill('milk');
    await expect(byId(page, 'search-result-count')).not.toHaveText(/^0 /);
  });
  await j.step('open the first result', async () => {
    const first = page.locator('[data-testid^="product-name-open-search-"]').filter({ visible: true }).first();
    const id = (await first.getAttribute('data-testid'))!.replace('product-name-open-search-', '');
    await first.tap();
    await expect(page).toHaveURL(new RegExp(`/product/${id}$`));
  });
  await j.step('back returns to the results with the query kept', async () => {
    await page.locator('[data-testid="pd-back-btn"]').tap({ timeout: 8_000 });
    await expect(page).toHaveURL(/\/search/);
    await expect(byId(page, 'search-input')).toHaveValue('milk');
  });
  await j.step('a nonsense query shows the empty state', async () => {
    await byId(page, 'search-input').fill('zzqxv');
    await expect(byId(page, 'search-no-results')).toBeVisible();
  });
  j.save();
});

test('product page back button returns to the previous screen', async ({ page }, testInfo) => {
  const m = monitor(page); const j = journey('product-back', page, m, testInfo);
  await j.step('open Groceries and a product', async () => {
    await openRoute(page, '/grocery', '[data-testid="department-screen-grocery"]');
    await tapId(page, 'product-name-open-grocery-p1');
    await expect(page).toHaveURL(/\/product\/p1$/);
  });
  await j.step('tap the back arrow (top-left)', async () => {
    const saved = await page.evaluate(() => localStorage.getItem('onecity.saved-products.v1'));
    // Tap where the back arrow is drawn, as a finger would.
    const box = (await byId(page, 'pd-back-btn').boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1_200);
    const savedAfter = await page.evaluate(() => localStorage.getItem('onecity.saved-products.v1'));
    expect(savedAfter, 'tapping "back" changed the wishlist instead (the heart sits on top of the back arrow)').toBe(saved);
    await expect(page).toHaveURL(/\/grocery$/);
  });
  j.save();
});

test('wishlist: save from a product card, see it in Wishlist, remove it', async ({ page }, testInfo) => {
  const m = monitor(page); const j = journey('wishlist', page, m, testInfo);
  await j.step('open Groceries', async () => { await openRoute(page, '/grocery', '[data-testid="department-screen-grocery"]'); });
  await j.step('tap the heart on Fresh Tomatoes', async () => {
    await tapId(page, 'save-product-grocery-p1');
    await expect(byId(page, 'save-product-grocery-p1')).toHaveAttribute('aria-label', /^Unsave/);
  });
  await j.step('open Wishlist from the profile', async () => {
    await scrollMain(page, 'top');
    await tapId(page, 'header-profile-btn');
    await expect(byId(page, 'account-wishlist-count')).toHaveText('1');
    await tapId(page, 'acc-wishlist');
    await expect(byId(page, 'product-card-wishlist-p1')).toBeVisible();
  });
  await j.step('un-heart it from the Wishlist', async () => {
    await tapId(page, 'save-product-wishlist-p1');
    await expect(byId(page, 'wishlist-empty')).toBeVisible();
  });
  await j.step('save from the product page heart', async () => {
    await openRoute(page, '/product/f1', '[data-testid="product-detail"]');
    await tapId(page, 'pd-save-product');
    await expect(byId(page, 'pd-save-product')).toHaveAttribute('aria-label', 'Remove from wishlist');
  });
  j.save();
});

test('store page: open from home, filter, follow, add, back', async ({ page }, testInfo) => {
  const m = monitor(page); const j = journey('store', page, m, testInfo);
  await j.step('open home and the Latur Fresh Mart store card', async () => {
    await openRoute(page, '/', '[data-testid="home-screen"]');
    await tapId(page, 'store-card-s1');
    await expect(page).toHaveURL(/\/store\/s1$/);
    await expect(byId(page, 'store-screen')).toBeVisible();
  });
  await j.step('follow the store', async () => {
    const before = await byId(page, 'follow-btn').innerText();
    await tapId(page, 'follow-btn');
    await expect(byId(page, 'follow-btn')).not.toHaveText(before);
  });
  await j.step('filter by a category chip', async () => {
    const chips = page.locator('[data-testid^="store-chip-"]').filter({ visible: true });
    expect(await chips.count()).toBeGreaterThan(1);
    const before = await page.locator('[data-testid^="product-card-"]').filter({ visible: true }).count();
    await chips.nth(1).tap();
    await page.waitForTimeout(600);
    const after = await page.locator('[data-testid^="product-card-"]').filter({ visible: true }).count();
    expect(after).toBeLessThanOrEqual(before);
  });
  await j.step('add a product from the store', async () => {
    const add = page.locator('[data-testid^="add-btn-"]').filter({ visible: true }).first();
    await add.scrollIntoViewIfNeeded(); await add.tap();
    await expect(page.locator('[data-testid^="stepper-"]').filter({ visible: true }).first()).toBeVisible();
  });
  await j.step('back returns home, where the followed store now appears first', async () => {
    await tapId(page, 'back-btn');
    await expect(byId(page, 'home-screen')).toBeVisible();
    await scrollMain(page, 'top');
    await expect(byId(page, 'followed-store-s1')).toBeVisible();
  });
  j.save();
});

test('brand page: open from home rail, follow brand, open its store profile', async ({ page }, testInfo) => {
  const m = monitor(page); const j = journey('brand', page, m, testInfo);
  await j.step('open home and tap the boAt brand tile', async () => {
    await openRoute(page, '/', '[data-testid="home-screen"]');
    await tapId(page, 'home-shops-brand-boat');
    await expect(page).toHaveURL(/\/brand\/boat$/);
    await expect(byId(page, 'brand-screen-boat')).toContainText('boAt');
  });
  await j.step('follow the brand', async () => {
    await tapId(page, 'brand-follow-boat');
    await expect(byId(page, 'brand-follow-boat')).toContainText('Following');
  });
  await j.step('open the brand’s store profile', async () => {
    await tapId(page, 'brand-store-boat');
    await expect(page).toHaveURL(/\/store\/boat$/);
    await expect(byId(page, 'store-screen')).toBeVisible();
    // The store follow button is an icon only; its state is the saved follow list.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('onelatur.followed.v1') || '[]'))).toContain('boat');
  });
  await j.step('home lists the followed brand under “Your local favourites”', async () => {
    await openRoute(page, '/', '[data-testid="home-screen"]');
    await expect(byId(page, 'followed-heading')).toBeVisible();
    await expect(byId(page, 'followed-store-boat')).toBeVisible();
  });
  j.save();
});

test('Book It: enquiry form validates, saves, and appears in My Bookings', async ({ page }, testInfo) => {
  const m = monitor(page); const j = journey('book-it', page, m, testInfo);
  await j.step('open Book It from the bottom navigation', async () => {
    await openRoute(page, '/', '[data-testid="home-screen"]');
    await tapId(page, 'tab-book-it');
    await expect(byId(page, 'department-screen-book-it')).toBeVisible();
  });
  await j.step('open a movie', async () => {
    await tapId(page, 'book-movies-event-e1');
    await expect(page).toHaveURL(/\/booking\/e1$/);
    await expect(byId(page, 'booking-event-title')).toBeVisible();
  });
  await j.step('submitting empty shows a validation message', async () => {
    await tapId(page, 'booking-submit');
    await expect(byId(page, 'booking-error')).toHaveText(/show time/);
  });
  await j.step('choose time, 2 guests, name and phone', async () => {
    await tapId(page, 'booking-time-1');
    await tapId(page, 'booking-guests-increase');
    await expect(byId(page, 'booking-guests')).toHaveText('2');
    await byId(page, 'booking-name').fill('Asha Patil');
    await byId(page, 'booking-phone').fill('9876543210');
  });
  await j.step('save the enquiry', async () => {
    await tapId(page, 'booking-submit');
    await expect(byId(page, 'booking-confirmation')).toBeVisible({ timeout: 30_000 });
    await expect(byId(page, 'booking-reference')).toHaveText(/Reference: \w+/);
  });
  await j.step('view it in My Bookings', async () => {
    await tapId(page, 'booking-view-enquiries');
    await expect(page).toHaveURL(/\/enquiries$/);
    await expect(page.locator('[data-testid^="saved-enquiry-"]').filter({ visible: true })).toHaveCount(1);
  });
  j.save();
});

test('Help & Support: FAQ opens, form validates and saves a request', async ({ page }, testInfo) => {
  const m = monitor(page); const j = journey('help', page, m, testInfo);
  await j.step('open Help from the profile', async () => {
    await openRoute(page, '/account', '[data-testid="account-screen"]');
    await tapId(page, 'acc-help');
    await expect(byId(page, 'help-screen')).toBeVisible();
  });
  await j.step('expand an FAQ', async () => {
    await tapId(page, 'help-faq-1');
    await expect(byId(page, 'help-answer-1')).toBeVisible();
  });
  await j.step('a too-short message is rejected', async () => {
    await tapId(page, 'help-topic-payment');
    await byId(page, 'help-message').fill('hi');
    await tapId(page, 'help-submit');
    await expect(byId(page, 'help-error')).toBeVisible();
  });
  await j.step('a proper message is saved with a reference', async () => {
    await byId(page, 'help-reference').fill('AUDIT-REF');
    await byId(page, 'help-message').fill('Audit test: my sample order shows the wrong total, please check.');
    await tapId(page, 'help-submit');
    await expect(byId(page, 'help-receipt')).toBeVisible({ timeout: 30_000 });
    await expect(byId(page, 'help-reference-number')).toHaveText(/Reference: \S+/);
  });
  j.save();
});

test('Saved addresses: add, edit, deliver here, remove', async ({ page }, testInfo) => {
  const m = monitor(page); const j = journey('addresses', page, m, testInfo);
  await j.step('open Saved Addresses from the profile', async () => {
    await openRoute(page, '/account', '[data-testid="account-screen"]');
    await tapId(page, 'acc-addresses');
    await expect(byId(page, 'addresses-empty')).toBeVisible();
  });
  await j.step('invalid details are rejected', async () => {
    await tapId(page, 'address-add');
    await byId(page, 'address-name-input').fill('A');
    await tapId(page, 'address-save');
    await expect(byId(page, 'address-error')).toBeVisible();
  });
  await j.step('add a Home address', async () => {
    await byId(page, 'address-name-input').fill('Asha Patil');
    await byId(page, 'address-phone-input').fill('9876543210');
    await byId(page, 'address-line-input').fill('Flat 4, Shivaji Apartments, Ausa Road');
    await byId(page, 'address-area-input').fill('Latur');
    await byId(page, 'address-pin-input').fill('413512');
    await tapId(page, 'address-save');
    await expect(byId(page, 'address-success')).toHaveText('Address saved.');
    await expect(page.locator('[data-testid^="address-card-"]').filter({ visible: true })).toHaveCount(1);
  });
  await j.step('edit it to Work and change the area', async () => {
    const edit = page.locator('[data-testid^="address-edit-"]').filter({ visible: true }).first();
    await edit.tap();
    await tapId(page, 'address-type-work');
    await byId(page, 'address-area-input').fill('MIDC Latur');
    await tapId(page, 'address-save');
    await expect(page.locator('[data-testid^="address-label-"]').filter({ visible: true }).first()).toHaveText('Work');
    await expect(page.locator('[data-testid^="address-details-"]').filter({ visible: true }).first()).toContainText('MIDC Latur');
  });
  await j.step('deliver here updates the delivery location', async () => {
    const use = page.locator('[data-testid^="address-use-"][data-testid$="address"], [data-testid^="address-use-address-"]').filter({ visible: true }).first();
    await use.tap();
    await expect(byId(page, 'address-success')).toContainText('Delivering to Work');
    await expect(use).toContainText('Selected for delivery');
  });
  await j.step('remove it (with confirmation)', async () => {
    await page.locator('[data-testid^="address-delete-"]').filter({ visible: true }).first().tap();
    await tapId(page, 'address-confirm-delete');
    await expect(byId(page, 'addresses-empty')).toBeVisible();
  });
  j.save();
});

test('Location picker: add a new address without a map (Maps key missing)', async ({ page }, testInfo) => {
  const m = monitor(page); const j = journey('location-new-address', page, m, testInfo);
  await j.step('open home and tap the location line', async () => {
    await openRoute(page, '/', '[data-testid="home-screen"]');
    await tapId(page, 'location-button');
    await expect(byId(page, 'location-screen')).toBeVisible();
  });
  await j.step('typing in place search explains that search is unavailable (Maps key missing)', async () => {
    await byId(page, 'location-search').fill('Ausa Road');
    const msg = page.locator('[data-testid="location-error"]').filter({ visible: true }).first();
    await expect(msg.or(page.getByText(/No places found/).filter({ visible: true }).first())).toBeVisible({ timeout: 15_000 });
    const text = (await msg.innerText().catch(() => '')) || 'No places found. Try a nearby landmark.';
    testInfo.annotations.push({ type: 'blocked: needs Maps key', description: `location search shows: "${text}"` });
    await byId(page, 'location-search').fill('');
  });
  await j.step('“Add new address” opens the pin screen (map is switched off)', async () => {
    await tapId(page, 'add-new-address');
    await expect(byId(page, 'address-map-screen')).toBeVisible();
    await expect(byId(page, 'address-map-missing')).toBeVisible();
  });
  await j.step('confirm the location and reach the details form', async () => {
    // Wait for the delivery-area check to finish (the button is disabled while it loads).
    await expect(page.getByText(/Pinned at|will be delivered here/i).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(byId(page, 'confirm-location')).toBeEnabled({ timeout: 15_000 });
    await page.waitForTimeout(800);
    await tapId(page, 'confirm-location');
    await expect(page).toHaveURL(/\/address-form/);
  });
  await j.step('fill the form and save', async () => {
    await byId(page, 'receiver-name').fill('Asha Patil');
    await byId(page, 'receiver-phone').fill('9876543210');
    await byId(page, 'address-building').fill('Flat 4, Shivaji Apartments');
    await byId(page, 'address-street').fill('Ausa Road');
    await byId(page, 'address-area').fill('Shivaji Nagar');
    await byId(page, 'address-pin').fill('413512');
    await tapId(page, 'save-address');
    await expect(byId(page, 'home-screen')).toBeVisible({ timeout: 20_000 });
  });
  await j.step('home header now shows the new address', async () => {
    await scrollMain(page, 'top');
    await expect(byId(page, 'selected-location')).toContainText(/Shivaji/);
  });
  j.save();
});

test('Profile edit and payment preference save', async ({ page }, testInfo) => {
  const m = monitor(page); const j = journey('profile-payments', page, m, testInfo);
  await j.step('open Edit profile from the account screen', async () => {
    await openRoute(page, '/account', '[data-testid="account-screen"]');
    await tapId(page, 'edit-profile-btn');
    await expect(byId(page, 'profile-edit-screen')).toBeVisible();
  });
  await j.step('an invalid phone number is rejected', async () => {
    await byId(page, 'profile-name-input').fill('Asha Patil');
    await byId(page, 'profile-phone-input').fill('12345');
    await tapId(page, 'profile-save');
    await expect(byId(page, 'profile-edit-error')).toBeVisible();
  });
  await j.step('save a valid profile and see it on the account screen', async () => {
    await byId(page, 'profile-phone-input').fill('9876543210');
    await tapId(page, 'profile-avatar-rocket');
    await tapId(page, 'profile-save');
    await expect(byId(page, 'profile-edit-success')).toBeVisible();
    await tapId(page, 'profile-edit-back');
    await expect(byId(page, 'account-name')).toHaveText('Asha Patil');
  });
  await j.step('save a payment preference', async () => {
    await tapId(page, 'acc-payments');
    // Online methods are "coming soon" (disabled); Cash on delivery is the one live choice.
    await tapId(page, 'preferences-method-cod');
    await tapId(page, 'payment-save');
    await expect(byId(page, 'payment-success')).toBeVisible();
  });
  j.save();
});
