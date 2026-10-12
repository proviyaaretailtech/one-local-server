/* Every screen the audit visits. Ids were taken from the running catalogue
 * (GET /api/catalog, /api/stores), not guessed. */
import { APIRequestContext, Page } from '@playwright/test';
import { CUSTOMER_KEY_STORAGE, cartItems, catalog, createOrder, newCustomerKey, seedStorage } from './helpers';

export type Screen = {
  name: string;            // unique, used for screenshot file names
  route: string | ((ctx: SetupContext) => Promise<string>);
  ready?: string;          // testID that proves the screen rendered (or several, comma-separated)
  tab?: boolean;           // reachable from the bottom navigation, so no back button is required
  expectMissing?: boolean; // an intentionally invalid id: the screen must say so and offer a way out
  blocked?: string;        // known configuration block (AI key / Maps key)
  setup?: (ctx: SetupContext) => Promise<void>;
};
export type SetupContext = { page: Page; request: APIRequestContext; key: string };

const seedCart = async ({ page, request, key }: SetupContext) => {
  const c = await catalog(request);
  const pick = ['p1', 'p3', 'f1', 'b2'].map(id => c.products.find(p => p.id === id)!).filter(Boolean);
  await seedStorage(page, { [CUSTOMER_KEY_STORAGE]: key, 'onelatur.cart.v1': cartItems(pick, 2) });
};
const seedSaved = async ({ page, key }: SetupContext) => {
  await seedStorage(page, { [CUSTOMER_KEY_STORAGE]: key, 'onecity.saved-products.v1': ['p1', 'f1', 'b2', 'sneak1', 'h1'] });
};
const seedAddresses = async ({ page, key }: SetupContext) => {
  await seedStorage(page, {
    [CUSTOMER_KEY_STORAGE]: key,
    'onecity.customer.v1': {
      profile: { name: 'Asha Patil', email: 'asha@example.com', phone: '9876543210', avatar: 'flower' }, payment: 'upi', referral: 'ONEAUDIT1',
      addresses: [
        { id: 'address-home', label: 'Home', kind: 'home', name: 'Asha Patil', phone: '9876543210', line: 'Flat 4, Shivaji Apartments, Ausa Road', building: 'Flat 4, Shivaji Apartments', street: 'Ausa Road', area: 'Latur', locality: 'Latur', pin: '413512' },
        { id: 'address-work', label: 'Work', kind: 'work', name: 'Asha Patil', phone: '9876543210', line: 'Office 12, Main Market Complex', building: 'Office 12', street: 'Main Market', area: 'Latur', locality: 'Latur', pin: '413512' },
      ],
    },
  });
};
const withOrder = async (ctx: SetupContext) => {
  const c = await catalog(ctx.request);
  const order = await createOrder(ctx.request, ctx.key, ['p1', 'f1', 'b2'].map(id => c.products.find(p => p.id === id)!));
  await seedStorage(ctx.page, { [CUSTOMER_KEY_STORAGE]: ctx.key });
  return order.id;
};

export const SCREENS: Screen[] = [
  // Tabs and department screens
  { name: 'home', route: '/', ready: 'home-screen', tab: true },
  { name: 'categories', route: '/categories', ready: 'categories-screen', tab: true },
  { name: 'discover', route: '/discover', ready: 'discover-screen', tab: true },
  { name: 'food', route: '/food', ready: 'department-screen-food', tab: true },
  { name: 'book-it', route: '/book-it', ready: 'department-screen-book-it', tab: true },
  { name: 'cart-empty', route: '/cart', ready: 'cart-screen' },
  { name: 'cart-filled', route: '/cart', ready: 'checkout-btn', setup: seedCart },
  { name: 'account', route: '/account', ready: 'account-screen' },
  { name: 'grocery', route: '/grocery', ready: 'department-screen-grocery' },
  { name: 'shops', route: '/shops', ready: 'department-screen-shops' },
  { name: 'care', route: '/care', ready: 'department-screen-care' },
  { name: 'pharmacy', route: '/pharmacy', ready: 'department-screen-care' },
  { name: 'beauty', route: '/beauty', ready: 'department-screen-care' },
  { name: 'reels', route: '/reels', ready: 'reels-screen' },
  // Search and AI
  { name: 'search', route: '/search', ready: 'search-screen' },
  { name: 'search-q-milk', route: '/search?q=milk', ready: 'search-screen' },
  { name: 'search-trending', route: '/search?collection=trending', ready: 'search-screen' },
  { name: 'smart-search-image', route: '/smart-search?mode=image', ready: 'smart-search-screen,coming-soon-ai_search', blocked: 'AI key' },
  { name: 'smart-search-voice', route: '/smart-search?mode=voice', ready: 'smart-search-screen,coming-soon-ai_search', blocked: 'AI key' },
  { name: 'assistant', route: '/assistant', ready: 'assistant-screen,coming-soon-assistant', blocked: 'AI key' },
  // Account area
  { name: 'wishlist-empty', route: '/wishlist', ready: 'wishlist-screen' },
  { name: 'wishlist-filled', route: '/wishlist', ready: 'wishlist-screen', setup: seedSaved },
  { name: 'wallet', route: '/wallet', ready: 'wallet-screen,coming-soon-wallet' },
  { name: 'orders-empty', route: '/orders', ready: 'orders-screen' },
  { name: 'orders-with-order', route: async ctx => { await withOrder(ctx); return '/orders'; }, ready: 'orders-screen' },
  { name: 'order-tracking', route: async ctx => `/order/${await withOrder(ctx)}`, ready: 'order-tracking' },
  { name: 'addresses-empty', route: '/addresses', ready: 'addresses-screen' },
  { name: 'addresses-saved', route: '/addresses', ready: 'addresses-screen', setup: seedAddresses },
  { name: 'address-form-manual', route: '/address-form?manual=1', ready: 'address-form-back' },
  { name: 'address-map', route: '/address-map', ready: 'address-map-screen,coming-soon-maps', blocked: 'Maps key' },
  { name: 'location', route: '/location', ready: 'location-screen', setup: seedAddresses },
  { name: 'profile-edit', route: '/profile-edit', ready: 'profile-edit-screen' },
  { name: 'payments', route: '/payments', ready: 'payments-screen' },
  { name: 'refer', route: '/refer', ready: 'refer-screen' },
  { name: 'help', route: '/help', ready: 'help-screen' },
  { name: 'enquiries', route: '/enquiries', ready: 'enquiries-screen' },
  { name: 'about', route: '/about', ready: 'about-screen' },
  { name: 'privacy', route: '/privacy', ready: 'privacy-screen', setup: seedAddresses },
  { name: 'privacy-notice', route: '/privacy-notice', ready: 'privacy-notice-screen' },
  // Dynamic routes with real ids
  { name: 'product-p1', route: '/product/p1', ready: 'product-detail' },
  { name: 'product-sneak1', route: '/product/sneak1', ready: 'product-detail' },
  { name: 'product-f1', route: '/product/f1', ready: 'product-detail' },
  { name: 'store-s1', route: '/store/s1', ready: 'store-screen' },
  { name: 'store-boat', route: '/store/boat', ready: 'store-screen' },
  { name: 'store-himalaya', route: '/store/himalaya', ready: 'store-screen' },
  { name: 'brand-boat', route: '/brand/boat', ready: 'brand-screen-boat' },
  { name: 'brand-himalaya', route: '/brand/himalaya', ready: 'brand-screen-himalaya' },
  { name: 'category-c1', route: '/category/c1', ready: 'category-screen' },
  { name: 'category-c9', route: '/category/c9', ready: 'category-screen' },
  { name: 'category-c15', route: '/category/c15', ready: 'category-screen' },
  { name: 'collection-festive', route: '/collection/festive', ready: 'collection-screen-festive' },
  { name: 'collection-fitness', route: '/collection/fitness', ready: 'collection-screen-fitness' },
  { name: 'booking-e1', route: '/booking/e1', ready: 'booking-screen' },
  // Invalid ids: the screen should explain and offer a way back
  { name: 'missing-product', route: '/product/does-not-exist', expectMissing: true },
  { name: 'missing-store', route: '/store/does-not-exist', expectMissing: true },
  { name: 'missing-brand', route: '/brand/does-not-exist', expectMissing: true },
  { name: 'missing-category', route: '/category/does-not-exist', expectMissing: true },
  { name: 'missing-collection', route: '/collection/does-not-exist', expectMissing: true },
  { name: 'missing-booking', route: '/booking/does-not-exist', expectMissing: true },
  { name: 'missing-order', route: '/order/does-not-exist', expectMissing: true },
];

/** CSS selector for a screen's ready marker(s). */
export const readySelector = (screen: Screen) => screen.ready ? screen.ready.split(',').map(id => `[data-testid="${id.trim()}"]`).join(', ') : undefined;

export async function prepare(screen: Screen, ctx: SetupContext): Promise<string> {
  if (screen.setup) await screen.setup(ctx);
  const route = typeof screen.route === 'string' ? screen.route : await screen.route(ctx);
  return route;
}
export { newCustomerKey };
