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
// arrived: when each pop-up id was first received this session (screen view index and time). A pop-up that went live
// while the app was already open (it is refetched every 30 s) arrives late: it gets its own app-open moment on the view
// it arrived in, and it may show even though another pop-up was already shown this session (never two at once).
// modalShownAt: when the last modal pop-up was counted as seen (0 = none yet).
export const session = {
  modalShown: false, modalShownAt: 0, viewIndex: 0, seenThisSession: new Set<string>(), firstViewOf: new Map<string, number>(),
  arrived: new Map<string, { view: number; at: number }>(),
};

// Remember when ids were first received; a refetch that brings nothing new changes nothing.
export function noteArrivals(ids: readonly string[], viewIndex: number, now = Date.now()) {
  for (const id of ids) if (!session.arrived.has(id)) session.arrived.set(id, { view: viewIndex, at: now });
}

// Went live after the screen's first view this session, so its app-open moment never came.
export function arrivedAfterFirstView(id: string, screen: string): boolean {
  const a = session.arrived.get(id); const first = session.firstViewOf.get(screen);
  return !!a && first !== undefined && a.view > first;
}

// Received after the last modal pop-up was seen: the one-pop-up-per-session rule does not hold it back.
export const arrivedAfterLastModal = (id: string) => {
  const a = session.arrived.get(id);
  return !!a && session.modalShownAt > 0 && a.at > session.modalShownAt;
};

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
  if (p.format !== 'strip') { session.modalShown = true; session.modalShownAt = Date.now(); }
  const before = await readSeen();
  const seen: Seen = { ...before, [p.id]: { at: Date.now(), n: timesShown(before[p.id]) + 1 } };
  // Only the pop-ups still worth remembering: a year is longer than any campaign.
  for (const [id, e] of Object.entries(seen)) if (Date.now() - lastAt(e) > 365 * 86_400_000) delete seen[id];
  seenCache = Promise.resolve(seen);
  AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen)).catch(() => {});
}
