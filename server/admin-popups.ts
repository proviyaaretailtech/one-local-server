// Marketing pop-ups, written from Master Admin (specs/marketing-popups/plan.md). Platform super admins only (requireAdmin).
// Customers read the live ones through GET /api/popups (server/popups.ts); this file is the admin side:
//   list / read / create / edit a draft, move it through the workflow (submit, return, approve, end) and read its numbers.
// The database (migration 0640) is the authority: shapes, frame, repeat rules, "a second person approves" and "frozen once
// submitted" are enforced there; the checks here only turn mistakes into clear messages before the write.
import { z } from 'zod';
import { AdminError, audit, requireAdmin } from './admin';
import { db, dbConfigured } from './db';
import { limit, readBody } from './http';
import { clearPopupCache } from './popups';

const bad = (detail: string, code = 'invalid_request') => new AdminError(400, code, detail);
const notFound = () => new AdminError(404, 'not_found', 'Pop-up not found');
const needDb = () => { if (!dbConfigured()) throw new AdminError(503, 'unavailable', 'Pop-ups need the database.'); };

const Text = z.string().trim();
const Lang = z.object({
  greeting: Text.max(60).optional(), title: Text.min(1).max(80), body: Text.max(280).optional(),
  cta_label: Text.max(30).optional(), cta_route: Text.regex(/^\/[A-Za-z0-9/_\-?=&.]*$/, 'cta_route must be an app path such as /grocery').max(200).optional(),
  image: Text.max(300).optional(),
}).strict();
const Media = z.object({
  type: z.enum(['photo', 'video']), key: Text.min(1).max(500), poster_key: Text.max(500).optional(), web_key: Text.max(500).optional(),
  width: z.number().int().min(320).max(2160), height: z.number().int().min(320).max(2700), seconds: z.number().positive().max(30).optional(),
  bytes: z.number().int().positive().optional(),
}).strict().refine(m => { const r = m.width / m.height; return Math.abs(r - 0.8) <= 0.008 || Math.abs(r - 1) <= 0.01; },
  'Photos and videos must be 4:5 (1080 x 1350) or square (1080 x 1080)')
  .refine(m => m.type === 'photo' || (m.seconds ?? 0) > 0, 'A video must say how long it is (at most 30 seconds)')
  .refine(m => m.type === 'video' || m.bytes === undefined || m.bytes <= 2 * 1024 * 1024, 'Photos can be at most 2 MB')
  .refine(m => m.type === 'photo' || m.bytes === undefined || m.bytes <= 15 * 1024 * 1024, 'Videos can be at most 15 MB');
const Frame = z.object({ style: z.enum(['royal_gold', 'festive_red', 'plain']), seal: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional() }).strict();
const Targeting = z.object({
  segments: z.array(z.enum(['new', 'new_signup', 'repeat', 'inactive_30d', 'has_cart'])).max(5).optional(),
  signup_within_days: z.number().int().min(1).max(90).optional(),
  languages: z.array(z.enum(['en', 'hi', 'mr'])).max(3).optional(),
  min_app_version: z.string().regex(/^\d+(\.\d+){0,3}$/).optional(),
}).strict();

const Draft = z.object({
  city_id: Text.min(1).max(40),
  format: z.enum(['letter', 'popup_center', 'popup_sheet', 'strip']),
  content: z.object({ en: Lang, hi: Lang.partial().optional(), mr: Lang.partial().optional() }).strict(),
  media: Media.nullable().optional(),
  frame: Frame.optional(),
  trigger: z.enum(['app_open', 'screen_view', 'after_seconds', 'first_sign_in']).default('app_open'),
  trigger_value: z.number().int().min(1).max(600).nullable().optional(),
  screens: z.array(z.string().regex(/^[a-z0-9_-]{1,40}$/)).min(1).max(12).default(['home']),
  targeting: Targeting.default({}),
  frequency: z.enum(['once', 'daily', 'session', 'every_hours', 'every_nth_open']).default('daily'),
  frequency_value: z.number().int().min(1).max(720).nullable().optional(),
  max_shows: z.number().int().min(1).max(100).nullable().optional(),
  priority: z.number().int().min(-100).max(100).default(0),
  is_sponsored: z.boolean().default(false),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
}).strict()
  .refine(p => new Date(p.ends_at) > new Date(p.starts_at), { message: 'The end must be after the start', path: ['ends_at'] })
  .refine(p => p.format !== 'letter' || !!p.media, { message: 'A letter needs a photo or a video', path: ['media'] })
  .refine(p => p.format !== 'letter' || !!p.frame, { message: 'A letter needs a frame style', path: ['frame'] })
  .refine(p => p.trigger !== 'first_sign_in' || p.frequency === 'once', { message: 'A first sign-in pop-up is shown once', path: ['frequency'] })
  .refine(p => p.trigger === 'after_seconds' ? !!p.trigger_value : !p.trigger_value, { message: 'Seconds are set only for "after N seconds"', path: ['trigger_value'] })
  .refine(p => p.frequency === 'every_hours' ? (p.frequency_value ?? 0) >= 1 : p.frequency === 'every_nth_open' ? (p.frequency_value ?? 0) >= 2 : !p.frequency_value,
    { message: 'Say how many hours (1-720) or which app open (2-50)', path: ['frequency_value'] });

const COLUMNS = 'id, city_id, format, content, media, frame, trigger, trigger_value, screens, targeting, frequency, frequency_value, max_shows, priority, is_sponsored, is_demo, starts_at, ends_at, status, created_by, submitted_by, submitted_at, approved_by, approved_at, ended_by, ended_at, created_at, updated_at';

const parseDraft = (body: unknown) => {
  const r = Draft.safeParse(body);
  if (!r.success) {
    const first = r.error.issues[0];
    // Our own rules read as sentences ("A letter needs a photo or a video"); field checks from zod get the field's name in front.
    throw bad(/^[A-Z]/.test(first.message) ? first.message : `${first.path.join('.') || 'pop-up'}: ${first.message}`);
  }
  // the first-sign-in welcome is for new sign-ups unless the admin narrowed it further
  const p = r.data;
  if (p.trigger === 'first_sign_in' && !p.targeting.segments?.includes('new_signup')) p.targeting.segments = [...(p.targeting.segments ?? []), 'new_signup'];
  return { ...p, media: p.media ?? null, frame: p.frame ?? {}, trigger_value: p.trigger_value ?? null, frequency_value: p.frequency_value ?? null, max_shows: p.max_shows ?? null };
};

// Database messages from 0640 become the admin's words.
function fromDb(error: { code?: string; message?: string }): never {
  const m = error.message ?? '';
  if (m.includes('OL_POPUP_SELF_APPROVAL')) throw new AdminError(409, 'self_approval', 'A second person must approve this pop-up.');
  if (m.includes('OL_POPUP_FROZEN')) throw new AdminError(409, 'frozen', 'A submitted, live or ended pop-up cannot be edited. End it and make a copy.');
  if (m.includes('OL_POPUP_BAD_MOVE')) throw new AdminError(409, 'bad_move', m.replace(/^.*OL_POPUP_BAD_MOVE:\s*/, '').replace(/^./, c => c.toUpperCase()) + '.');
  if (m.includes('OL_POPUP_EXPIRED')) throw new AdminError(409, 'expired', 'The end date has already passed. Change the dates first.');
  if (m.includes('OL_POPUP_NOT_FOUND')) throw notFound();
  if (error.code === '23503') throw bad('That city does not exist.', 'unknown_city');
  if (error.code === '23514') throw bad('The pop-up breaks a rule: ' + (m.match(/constraint "([^"]+)"/)?.[1] ?? 'check the fields') + '.');
  console.error('[admin-popups] database error', error.code);
  throw new AdminError(500, 'server_error', 'Could not save the pop-up. Please try again.');
}

const PopupId = z.uuid();
const idOf = (id: string) => { if (!PopupId.safeParse(id).success) throw notFound(); return id; };

export async function listPopups(request: Request) {
  await requireAdmin(request, false); needDb();
  const url = new URL(request.url);
  let q = db().from('ol_popups').select(COLUMNS, { count: 'exact' }).order('created_at', { ascending: false }).limit(200);
  const status = url.searchParams.get('status'); const city = url.searchParams.get('city');
  if (status && ['draft', 'submitted', 'approved', 'live', 'ended'].includes(status)) q = q.eq('status', status);
  if (city && /^[a-z0-9_-]{1,40}$/.test(city)) q = q.eq('city_id', city);
  const { data, error, count } = await q;
  if (error) fromDb(error);
  return { rows: data ?? [], total: count ?? 0 };
}

export async function getPopup(request: Request, id: string) {
  await requireAdmin(request, false); needDb();
  const { data, error } = await db().from('ol_popups').select(COLUMNS).eq('id', idOf(id)).maybeSingle();
  if (error) fromDb(error);
  if (!data) throw notFound();
  const { data: history } = await db().from('ol_popup_audit').select('action, actor, at, detail').eq('popup_id', id).order('at', { ascending: true });
  return { ...data, history: history ?? [] };
}

export async function createPopup(request: Request) {
  const admin = await requireAdmin(request, true); needDb();
  limit(admin.userId, 'admin-popup-write', 60, 60_000);
  const draft = parseDraft(await readBody(request, 64 * 1024));
  const { data, error } = await db().from('ol_popups').insert({ ...draft, status: 'draft', created_by: admin.userId }).select(COLUMNS).single();
  if (error) fromDb(error);
  await db().from('ol_popup_audit').insert({ popup_id: data.id, action: 'created', actor: admin.userId });
  audit(admin, 'popup.created', data.id, { format: draft.format });
  return data;
}

export async function updatePopup(request: Request, id: string) {
  const admin = await requireAdmin(request, true); needDb();
  limit(admin.userId, 'admin-popup-write', 60, 60_000);
  const draft = parseDraft(await readBody(request, 64 * 1024));
  const { data, error } = await db().from('ol_popups').update(draft).eq('id', idOf(id)).select(COLUMNS).maybeSingle();
  if (error) fromDb(error);
  if (!data) throw notFound();
  await db().from('ol_popup_audit').insert({ popup_id: id, action: 'edited', actor: admin.userId });
  audit(admin, 'popup.edited', id);
  return data;
}

const Action = z.object({ action: z.enum(['submit', 'return', 'approve', 'end']), note: z.string().trim().max(300).optional() });

export async function popupAction(request: Request, id: string) {
  const admin = await requireAdmin(request, true); needDb();
  limit(admin.userId, 'admin-popup-write', 60, 60_000);
  const body = Action.safeParse(await readBody(request, 4 * 1024));
  if (!body.success) throw bad('action must be submit, return, approve or end.');
  const { data, error } = await db().rpc('ol_popup_set_status', { p_id: idOf(id), p_action: body.data.action, p_actor: admin.userId, p_note: body.data.note ?? null });
  if (error) fromDb(error);
  clearPopupCache();
  audit(admin, `popup.${body.data.action}`, id);
  return data;
}

// Shown / tapped / closed per day for one pop-up (from ol_popup_events), plus how many people saw it.
export async function popupResults(request: Request, id: string) {
  await requireAdmin(request, false); needDb();
  const { data, error } = await db().from('ol_popup_events').select('event, at, customer_key_hash').eq('popup_id', idOf(id)).order('at', { ascending: false }).limit(20000);
  if (error) fromDb(error);
  const days = new Map<string, { day: string; impression: number; tap: number; close: number }>();
  const people = new Set<string>();
  for (const e of data ?? []) {
    const day = new Date(e.at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const row = days.get(day) ?? { day, impression: 0, tap: 0, close: 0 };
    row[e.event as 'impression' | 'tap' | 'close'] += 1; days.set(day, row);
    if (e.event === 'impression') people.add(e.customer_key_hash);
  }
  const rows = [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
  const total = rows.reduce((t, r) => ({ impression: t.impression + r.impression, tap: t.tap + r.tap, close: t.close + r.close }), { impression: 0, tap: 0, close: 0 });
  return { total, people: people.size, days: rows };
}
