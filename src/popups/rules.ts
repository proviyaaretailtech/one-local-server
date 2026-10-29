// Rules the app enforces for pop-ups whatever the CMS says (specs/home-cms/spec.md §2.5): blocked screens, one pop-up per
// app session and per screen view (strips excepted), and the per-pop-up frequency cap remembered on the phone.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Popup } from './types';

// Never over sign-in, the welcome step, choosing a location, cart / checkout, payment, payment result or live order tracking.
const BLOCKED = [/^\/sign-in(\/|$)/, /^\/welcome(\/|$)/, /^\/location(\/|$)/, /^\/cart(\/|$)/, /^\/checkout(\/|$)/, /^\/payments?(\/|$)/, /^\/payment-result(\/|$)/, /^\/order\//];
export const isBlockedPath = (pathname: string) => BLOCKED.some(r => r.test(pathname));

// The screen name the server knows: the first path segment, '/' is home. '/store/abc' -> 'store'.
export const screenOf = (pathname: string) => (pathname.split('/').filter(Boolean)[0] ?? 'home').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'home';

// Per JavaScript runtime = per app session.
// firstViewOf: the first view of each screen in this session. An app_open pop-up shows on that view only, so a
// first-run detour (language, location) before home does not use up the app-open moment.
export const session = { modalShown: false, viewIndex: 0, seenThisSession: new Set<string>(), firstViewOf: new Map<string, number>() };

const SEEN_KEY = 'onecity.popups.seen.v1';
// popup id -> last shown (ms), or { at, n } once it also counts how many times (older entries are a plain number).
type SeenEntry = number | { at: number; n: number };
type Seen = Record<string, SeenEntry>;
let seenCache: Promise<Seen> | null = null;
const readSeen = () => (seenCache ??= AsyncStorage.getItem(SEEN_KEY).then(v => (v ? JSON.parse(v) as Seen : {})).catch((): Seen => ({})));
const lastAt = (e: SeenEntry | undefined) => (e === undefined ? 0 : typeof e === 'number' ? e : e.at);
const timesShown = (e: SeenEntry | undefined) => (e === undefined ? 0 : typeof e === 'number' ? 1 : e.n);

// App opens on this phone, counted once per app session, for "every Nth app open".
const OPENS_KEY = 'onecity.popups.opens.v1';
let opensThisSession: Promise<number> | null = null;
export const appOpens = () => (opensThisSession ??= AsyncStorage.getItem(OPENS_KEY)
  .then(v => { const n = (parseInt(v ?? '0', 10) || 0) + 1; AsyncStorage.setItem(OPENS_KEY, String(n)).catch(() => {}); return n; })
  .catch(() => 1));

const sameLocalDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

export async function allowedByFrequency(p: Popup): Promise<boolean> {
  if (session.seenThisSession.has(p.id)) return false;   // every frequency allows at most once per session
  const entry = (await readSeen())[p.id];
  if (p.max_shows && timesShown(entry) >= p.max_shows) return false;
  if (p.frequency === 'session') return true;
  // every Nth open: the 1st, (N+1)th, (2N+1)th … open of the app on this phone
  if (p.frequency === 'every_nth_open') return ((await appOpens()) - 1) % Math.max(2, p.frequency_value ?? 2) === 0;
  const last = lastAt(entry);
  if (!last) return true;
  if (p.frequency === 'every_hours') return Date.now() - last >= Math.max(1, p.frequency_value ?? 24) * 3_600_000;
  return p.frequency === 'daily' ? !sameLocalDay(last, Date.now()) : false;
}

export async function markShown(p: Popup): Promise<void> {
  session.seenThisSession.add(p.id);
  if (p.format !== 'strip') session.modalShown = true;
  const before = await readSeen();
  const seen: Seen = { ...before, [p.id]: { at: Date.now(), n: timesShown(before[p.id]) + 1 } };
  // Only the pop-ups still worth remembering: a year is longer than any campaign.
  for (const [id, e] of Object.entries(seen)) if (Date.now() - lastAt(e) > 365 * 86_400_000) delete seen[id];
  seenCache = Promise.resolve(seen);
  AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen)).catch(() => {});
}
