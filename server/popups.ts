// Customer-app pop-ups (specs/home-cms/spec.md §2.5). Read side: live pop-ups of a city for one screen, filtered by the
// caller's language, app version and segment. Write side: impressions, taps and closes, stored under the caller's hash
// (the same hash ol_orders.customer_hash holds, auth.ts caller()). Migration 0330 creates ol_popups / ol_popup_events.
// Live rows are cached per city for 30 s like the catalogue; the date window is re-checked on every request.
import { z } from 'zod';
import { caller } from './auth';
import { resolveCity } from './catalog';
import { db, dbConfigured, fromDbError } from './db';
import { HttpError, limit, readBody } from './http';

// Screens a pop-up may never cover, whatever the CMS says (spec §2.5 rule 2): sign-in, cart / checkout, payment, payment
// result and live order tracking. The app enforces the same list on its side.
export const BLOCKED_SCREENS = new Set(['sign-in', 'cart', 'checkout', 'payment', 'payments', 'payment-result', 'order']);

const Lang = z.enum(['en', 'hi', 'mr']);
const Content = z.object({
  title: z.string(), body: z.string().optional(), image: z.string().optional(),
  cta_label: z.string().optional(), cta_route: z.string().optional(),
  items: z.array(z.object({ name: z.string(), logo: z.string(), line: z.string().optional() })).optional(),
}).partial();
const Targeting = z.object({
  segments: z.array(z.enum(['new', 'repeat', 'inactive_30d', 'has_cart'])).optional(),
  languages: z.array(Lang).optional(),
  min_app_version: z.string().optional(),
}).catch({});

export type Popup = {
  id: string; format: 'popup_center' | 'popup_sheet' | 'interstitial' | 'strip' | 'coming_soon';
  content: Partial<Record<z.infer<typeof Lang>, z.infer<typeof Content>>>;
  trigger: 'app_open' | 'screen_view' | 'after_seconds' | 'scroll_depth'; trigger_value: number | null;
  screens: string[]; frequency: 'once' | 'daily' | 'session'; priority: number; is_sponsored: boolean;
  starts_at: string; ends_at: string;
};
type Row = Popup & { targeting: unknown };

const TTL_MS = 30_000;
const cache = new Map<string, { rows: Row[]; at: number }>();
const inFlight = new Map<string, Promise<Row[]>>();

async function liveRows(city: string): Promise<Row[]> {
  const hit = cache.get(city);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  const running = inFlight.get(city);
  if (running) return running;
  const load = (async () => {
    const now = new Date().toISOString();
    const { data, error } = await db().from('ol_popups')
      .select('id, format, content, trigger, trigger_value, screens, targeting, frequency, priority, is_sponsored, starts_at, ends_at')
      .eq('city_id', city).eq('status', 'live').lte('starts_at', now).gt('ends_at', now)
      .order('priority', { ascending: false }).order('starts_at', { ascending: true });
    // Before migration 0330 is applied there are simply no pop-ups.
    if (error && ['PGRST205', '42P01'].includes(error.code ?? '')) return [];
    if (error) fromDbError(error);
    const rows = (data ?? []) as Row[];
    cache.set(city, { rows, at: Date.now() });
    return rows;
  })().finally(() => inFlight.delete(city));
  inFlight.set(city, load);
  return load;
}

// '1.10.0' >= '1.9.2'; anything unparsable counts as 0.
const versionAtLeast = (have: string, need: string) => {
  const a = have.split('.').map(n => parseInt(n, 10) || 0), b = need.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d > 0; }
  return true;
};

// new / repeat / inactive_30d from the caller's orders; looked up only when a candidate pop-up targets one of them.
async function orderSegments(request: Request): Promise<Set<string>> {
  const who = await caller(request);
  if (!who.matches.length) return new Set(['new']);
  const { data, error } = await db().from('ol_orders').select('created_at').in('customer_hash', who.matches).order('created_at', { ascending: false }).limit(2);
  if (error) fromDbError(error);
  const rows = data ?? [];
  const out = new Set<string>([rows.length === 0 ? 'new' : 'repeat']);
  if (rows.length && Date.now() - new Date(rows[0].created_at).getTime() > 30 * 86_400_000) out.add('inactive_30d');
  return out;
}

const Query = z.object({
  screen: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,40}$/),
  lang: Lang.catch('en'),
  app_version: z.string().regex(/^\d+(\.\d+){0,3}$/).optional().catch(undefined),
  cart: z.enum(['0', '1']).optional().catch(undefined),
});

export async function livePopups(request: Request): Promise<{ popups: Popup[] }> {
  const city = resolveCity(request);
  const url = new URL(request.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw new HttpError(400, 'Say which screen the pop-ups are for', undefined, 'invalid_screen');
  const q = parsed.data;
  if (BLOCKED_SCREENS.has(q.screen) || !dbConfigured()) return { popups: [] };

  const candidates = (await liveRows(city)).filter(p => {
    const now = Date.now();
    if (new Date(p.starts_at).getTime() > now || new Date(p.ends_at).getTime() <= now) return false;
    if (!p.screens?.includes(q.screen)) return false;
    const t = Targeting.parse(p.targeting ?? {});
    if (t.languages?.length && !t.languages.includes(q.lang)) return false;
    if (t.min_app_version && !(q.app_version && versionAtLeast(q.app_version, t.min_app_version))) return false;
    return true;
  });
  let segments: Set<string> | null = null;
  const out: Popup[] = [];
  for (const p of candidates) {
    const wanted = Targeting.parse(p.targeting ?? {}).segments ?? [];
    if (wanted.length) {
      if (wanted.some(s => s !== 'has_cart')) segments ??= await orderSegments(request);
      const mine = new Set(segments ?? []);
      if (q.cart === '1') mine.add('has_cart');
      if (!wanted.some(s => mine.has(s))) continue;
    }
    const { targeting: _t, ...popup } = p;
    out.push(popup);
  }
  return { popups: out };
}

const EventBody = z.object({ event: z.enum(['impression', 'tap', 'close']) });
const PopupId = z.uuid();

export async function recordPopupEvent(request: Request, id: string): Promise<{ ok: true }> {
  if (!PopupId.safeParse(id).success) throw new HttpError(404, 'This pop-up does not exist', undefined, 'popup_not_found');
  const body = EventBody.safeParse(await readBody(request, 1024));
  if (!body.success) throw new HttpError(400, 'event must be impression, tap or close', undefined, 'invalid_event');
  const who = await caller(request);
  if (!who.owner) throw new HttpError(401, 'Please update the app and try again.', undefined, 'customer_key_missing');
  limit(who.owner, 'popup-event', 30, 60_000);
  if (!dbConfigured()) return { ok: true };
  const { error } = await db().from('ol_popup_events').insert({ popup_id: id, customer_key_hash: who.owner, event: body.data.event });
  if (error?.code === '23503') throw new HttpError(404, 'This pop-up does not exist', undefined, 'popup_not_found');
  if (error) fromDbError(error);
  return { ok: true };
}
