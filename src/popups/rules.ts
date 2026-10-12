// Rules the app enforces for pop-ups whatever the CMS says (specs/home-cms/spec.md §2.5): blocked screens, one pop-up per
// app session and per screen view (strips excepted), and the per-pop-up frequency cap remembered on the phone.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Popup } from './types';

// Never over sign-in, cart / checkout, payment, payment result or live order tracking.
const BLOCKED = [/^\/sign-in(\/|$)/, /^\/cart(\/|$)/, /^\/checkout(\/|$)/, /^\/payments?(\/|$)/, /^\/payment-result(\/|$)/, /^\/order\//];
export const isBlockedPath = (pathname: string) => BLOCKED.some(r => r.test(pathname));

// The screen name the server knows: the first path segment, '/' is home. '/store/abc' -> 'store'.
export const screenOf = (pathname: string) => (pathname.split('/').filter(Boolean)[0] ?? 'home').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'home';

// Per JavaScript runtime = per app session.
// firstViewOf: the first view of each screen in this session. An app_open pop-up shows on that view only, so a
// first-run detour (language, location) before home does not use up the app-open moment.
export const session = { modalShown: false, viewIndex: 0, seenThisSession: new Set<string>(), firstViewOf: new Map<string, number>() };

const SEEN_KEY = 'onecity.popups.seen.v1';
type Seen = Record<string, number>;   // popup id -> last shown (ms)
let seenCache: Promise<Seen> | null = null;
const readSeen = () => (seenCache ??= AsyncStorage.getItem(SEEN_KEY).then(v => (v ? JSON.parse(v) as Seen : {})).catch((): Seen => ({})));

const sameLocalDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

export async function allowedByFrequency(p: Popup): Promise<boolean> {
  if (session.seenThisSession.has(p.id)) return false;   // every frequency allows at most once per session
  if (p.frequency === 'session') return true;
  const last = (await readSeen())[p.id];
  if (!last) return true;
  return p.frequency === 'daily' ? !sameLocalDay(last, Date.now()) : false;
}

export async function markShown(p: Popup): Promise<void> {
  session.seenThisSession.add(p.id);
  if (p.format !== 'strip') session.modalShown = true;
  const seen = { ...(await readSeen()), [p.id]: Date.now() };
  // Only the pop-ups still worth remembering: a year is longer than any campaign.
  for (const [id, at] of Object.entries(seen)) if (Date.now() - at > 365 * 86_400_000) delete seen[id];
  seenCache = Promise.resolve(seen);
  AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen)).catch(() => {});
}
