// "Everything is coming soon" switch. On by default, so the build a store reviewer or client installs shows
// no live functions. Set EXPO_PUBLIC_COMING_SOON=off at build time to turn it off and go back to live features.
export const COMING_SOON_ALL = process.env.EXPO_PUBLIC_COMING_SOON !== 'off';

// Top-level route segments that stay usable while the switch is on: the tab bar and the whole browse path
// (search, category and sub-category, collection, store, brand, product, the India place browser), all read only;
// sign-in (and the one-time "One last step" after it: name and delivery place), editing the profile, and static pages.
// Every route that orders, pays or books (cart, checkout, orders, payments, wallet, booking…) shows the coming-soon
// page instead, and any write still goes through apiPost, which is blocked.
export const OPEN_SEGMENTS = ['(tabs)', 'sign-in', 'welcome', 'profile-edit', 'location', 'help', 'about', 'privacy', 'privacy-notice', 'language',
  'search', 'category', 'collection', 'store', 'brand', 'product', 'india'];
// Tabs that are covered too, even though the tab bar is open: the bag (no ordering in this build).
export const BLOCKED_TABS = ['cart'];

/** True when the route (expo-router segments) should show the coming-soon page. */
export function isComingSoonRoute(segments: readonly string[]): boolean {
  if (!COMING_SOON_ALL || segments.length === 0) return false;
  if (!OPEN_SEGMENTS.includes(segments[0])) return true;
  return segments[0] === '(tabs)' && BLOCKED_TABS.includes(segments[1] ?? '');
}

// A person's own data rights stay working while everything else is switched off: recording consent, asking for
// their data to be erased, raising a grievance, naming a nominee. Google Play and the DPDP Act both require
// account deletion and these rights to work, so apiPost lets any path under /privacy/ through.
export const ALWAYS_OPEN_API_PREFIXES = ['/privacy/'];
export const isAlwaysOpenApi = (path: string) => ALWAYS_OPEN_API_PREFIXES.some(prefix => path.startsWith(prefix));

// A blocked write (any POST through apiPost) tells the screen on top to show the coming-soon banner.
const listeners = new Set<() => void>();
export function announceComingSoon() { listeners.forEach(l => l()); }
export function onComingSoon(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
