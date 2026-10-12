// Privacy rights under India's Digital Personal Data Protection Act 2023 and the DPDP Rules 2025
// (docs/DPDP.md). A signed-in person can:
//   GET  /api/privacy/export      download everything we hold about them (s.11)
//   GET  /api/privacy/consents    read their current consent choices
//   POST /api/privacy/consents    record consent choices, append-only, with the notice version (s.6)
//   POST /api/privacy/erasure     delete their account data; what the law makes us keep is kept, unlinked (s.12)
//   POST /api/privacy/grievances  raise a grievance or ask for a correction, with a reference (s.13)
//   POST /api/privacy/nominee     nominate someone to act for them after death or incapacity (s.14)
// Signed-in only (a device key alone is not a person), rate-limited, and audit-logged without
// personal data: the log line carries a short one-way tag of the account, the reference, and counts.
//
// Storage follows store.ts: Postgres when Supabase is configured, in-process memory otherwise.
// ol_consents and ol_privacy_requests come with draft migration 0027; until it is applied, requests
// fall back to the help-request table (ol_support_requests, reference "privacy:<ref>") so a person
// is never left unanswered, and consents are kept on the phone and sent again later.
import { caller } from './auth';
import { db, dbConfigured, fromDbError } from './db';
import { HttpError, limit, readBody, sha256 } from './http';
import { memoryRecords } from './store';
import {
  CONSENT_SOURCES, ConsentPurpose, KEPT_BY_LAW, NOTICE_ITEMS, OPTIONAL_PURPOSES, PRIVACY, RECORDED_PURPOSES, SHARED_WITH,
} from '../constants/privacy';

export type RequestKind = 'export' | 'erasure' | 'correction' | 'nominee' | 'grievance';
export type RequestStatus = 'received' | 'in_progress' | 'completed' | 'partially_completed' | 'rejected' | 'withdrawn';
export type ConsentRecord = {
  user_id: string; purpose: ConsentPurpose; granted: boolean; notice_version: string; source: string;
  given_at: string | null; created_at: string;
};
export type PrivacyRequest = {
  id: string; user_id: string | null; kind: RequestKind; status: RequestStatus; reference: string;
  details: Record<string, unknown>; due_at: string | null; resolved_at: string | null; created_at: string;
};

// ---------- In-memory fallback (no database configured) ----------
type PrivacyMemory = { consents: ConsentRecord[]; requests: PrivacyRequest[] };
const g = globalThis as unknown as { __onecityPrivacy?: PrivacyMemory };
const mem: PrivacyMemory = (g.__onecityPrivacy ??= { consents: [], requests: [] });

const DAY = 86_400_000;
const PREFIX: Record<RequestKind, string> = { export: 'EX', erasure: 'ER', correction: 'CR', nominee: 'NM', grievance: 'GR' };
const OPEN_ORDER = ['placed', 'accepted', 'packed', 'out'];

// ---------- Who is asking ----------
// `tag` is what the audit log shows: a one-way, shortened hash, never the account id itself.
type Person = { userId: string; tag: string; matches: string[]; token: string };
async function person(request: Request, action: string): Promise<Person> {
  const who = await caller(request);
  if (!who.userId) throw new HttpError(401, `Please sign in to ${action}.`);
  const token = request.headers.get('authorization')?.slice(7).trim() ?? '';
  return { userId: who.userId, tag: (await sha256(`privacy:${who.userId}`)).slice(0, 12), matches: who.matches, token };
}

// Audit trail for privacy actions. Facts are references, kinds, statuses and counts only: never a
// name, phone, email, address, message or account id.
function audit(event: string, p: Person, facts: Record<string, string | number | boolean | null> = {}) {
  console.info('[privacy]', JSON.stringify({ at: new Date().toISOString(), event, who: p.tag, ...facts }));
}

// e.g. GR-260927-7KQ2MX: kind, date, six characters that are easy to read aloud on a phone call.
function newReference(kind: RequestKind): string {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const random = crypto.getRandomValues(new Uint8Array(6));
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `${PREFIX[kind]}-${date}-${Array.from(random, b => letters[b % letters.length]).join('')}`;
}

// Migration 0027 is a draft until the founder approves it; checked again once a minute (like
// store.ts checkoutsReady). A table that does not exist is PGRST205 (Postgres 42P01).
const ready = new Map<string, { ok: boolean; at: number }>();
async function tableReady(table: string): Promise<boolean> {
  const hit = ready.get(table);
  if (hit && (hit.ok || Date.now() - hit.at < 60_000)) return hit.ok;
  const { error } = await db().from(table).select('*', { head: true, count: 'exact' }).limit(1);
  if (error && !['PGRST205', '42P01'].includes(error.code ?? '')) fromDbError(error);
  ready.set(table, { ok: !error, at: Date.now() });
  return !error;
}

// PostgREST filter for "this person's rows": linked to the account, or placed from this device
// before signing in (what My Orders already shows them). Ids and hashes are hex/uuid only.
const mine = (p: Person) => `user_id.eq.${p.userId},customer_hash.in.(${p.matches.join(',')})`;
const isMine = (p: Person, row: { customer?: string | null; user_id?: string | null }) =>
  row.user_id === p.userId || (!!row.customer && p.matches.includes(row.customer));

// ---------- Privacy requests: saved, and updated as they progress ----------
type Saved = PrivacyRequest & { stored: 'memory' | 'database' | 'help_requests' | 'log_only' };

function summary(req: PrivacyRequest): string {
  const lines = [`Privacy request ${req.reference} (${req.kind}), status ${req.status}.`];
  if (typeof req.details.message === 'string') lines.push(req.details.message);
  if (req.details.nominee) lines.push(`Nominee: ${JSON.stringify(req.details.nominee)}`);
  if (req.details.outcome) lines.push(`Outcome: ${JSON.stringify(req.details.outcome)}`);
  if (req.due_at) lines.push(`Answer by ${req.due_at.slice(0, 10)}.`);
  return lines.join('\n').slice(0, 2000);
}

async function saveRequest(p: Person, kind: RequestKind, status: RequestStatus, details: Record<string, unknown>, dueDays: number | null): Promise<Saved> {
  const now = new Date();
  const req: PrivacyRequest = {
    id: crypto.randomUUID(), user_id: p.userId, kind, status, reference: newReference(kind), details,
    due_at: dueDays === null ? null : new Date(now.getTime() + dueDays * DAY).toISOString(),
    resolved_at: status === 'completed' ? now.toISOString() : null, created_at: now.toISOString(),
  };
  if (!dbConfigured()) { mem.requests.push(req); return { ...req, stored: 'memory' }; }
  if (await tableReady('ol_privacy_requests')) {
    const { error } = await db().from('ol_privacy_requests').insert(req);
    if (error) fromDbError(error);
    return { ...req, stored: 'database' };
  }
  // Before 0027: a download needs no follow-up, so the audit line is its record; anything someone
  // must act on goes to the help-request queue the team already reads.
  if (kind === 'export') return { ...req, stored: 'log_only' };
  const { error } = await db().from('ol_support_requests').insert({
    id: req.id, topic: 'other', message: summary(req), reference: `privacy:${req.reference}`, status: 'saved_for_review',
    customer_hash: null, user_id: p.userId, created_at: req.created_at,
  });
  if (error) fromDbError(error);
  return { ...req, stored: 'help_requests' };
}

async function updateRequest(req: Saved, patch: Partial<Pick<PrivacyRequest, 'status' | 'details' | 'resolved_at'>>): Promise<Saved> {
  const next: Saved = { ...req, ...patch };
  if (req.stored === 'memory') {
    const row = mem.requests.find(r => r.id === req.id);
    if (row) Object.assign(row, patch);
  } else if (req.stored === 'database') {
    const { error } = await db().from('ol_privacy_requests').update(patch).eq('id', req.id);
    if (error) fromDbError(error);
  } else if (req.stored === 'help_requests') {
    const { error } = await db().from('ol_support_requests').update({ message: summary(next) }).eq('id', req.id);
    if (error) fromDbError(error);
  }
  return next;
}

// ---------- Account (Supabase Auth) ----------
// Asked with the person's own token, so it works with or without the database connected.
type Account = { id: string; email: string | null; phone: string | null; name: string | null; created_at: string | null; last_sign_in_at: string | null; sign_in_methods: string[] };
const authConfig = () => ({ url: process.env.SUPABASE_URL, apikey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY });
async function accountOf(p: Person): Promise<Account> {
  const base: Account = { id: p.userId, email: null, phone: null, name: null, created_at: null, last_sign_in_at: null, sign_in_methods: [] };
  const { url, apikey } = authConfig();
  if (!url || !apikey || !p.token) return base;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${p.token}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return base;
    const u = await r.json();
    return {
      id: p.userId, email: u.email || null, phone: u.phone ? `+${String(u.phone).replace(/^\+/, '')}` : null,
      name: u.user_metadata?.full_name || u.user_metadata?.name || null, created_at: u.created_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null, sign_in_methods: Array.isArray(u.app_metadata?.providers) ? u.app_metadata.providers : [],
    };
  } catch {
    return base;
  }
}

// ---------- Everything we hold for a person ----------
type Row = Record<string, unknown>;
type Records = {
  orders: Row[]; checkouts: Row[]; refunds: Row[]; support_requests: Row[]; launch_requests: Row[];
  booking_enquiries: Row[]; consents: Row[]; privacy_requests: Row[];
};
// Internal keys that mean nothing to the person (and, for a device key hash, could help someone
// else guess at their guest orders) are left out of the download, as is a rider's phone number.
const INTERNAL = ['customer_hash', 'customer', 'idempotency_key', 'rider_phone'];
const clean = (row: object): Row => Object.fromEntries(Object.entries(row).filter(([k]) => !INTERNAL.includes(k)));
const isLaunch = (row: { reference?: unknown }) => typeof row.reference === 'string' && row.reference.startsWith('launch:');

function recordsFromMemory(p: Person): Records {
  const store = memoryRecords();
  const checkouts = store.checkouts.filter(c => isMine(p, c));
  const support = store.support.filter(s => isMine(p, s));
  return {
    orders: store.orders.filter(o => isMine(p, o)).map(clean),
    checkouts: checkouts.map(({ refunds, ...c }) => clean(c)),
    refunds: checkouts.flatMap(c => c.refunds.map(r => ({ checkout_id: c.id, reference: r.id, amount: r.amount }))),
    support_requests: support.filter(s => !isLaunch(s)).map(clean),
    launch_requests: support.filter(isLaunch).map(clean),
    booking_enquiries: store.enquiries.filter(e => isMine(p, e)).map(clean),
    consents: mem.consents.filter(c => c.user_id === p.userId).map(clean),
    privacy_requests: mem.requests.filter(r => r.user_id === p.userId).map(clean),
  };
}

async function select(table: string, filter: (q: any) => any, columns = '*'): Promise<Row[]> {
  const { data, error } = await filter(db().from(table).select(columns)).order('created_at', { ascending: false }).range(0, 4999);
  if (error) fromDbError(error);
  return (data ?? []) as Row[];
}

async function recordsFromDatabase(p: Person): Promise<Records> {
  const [orders, support, enquiries] = await Promise.all([
    select('ol_orders', q => q.or(mine(p))),
    select('ol_support_requests', q => q.or(mine(p))),
    select('ol_booking_enquiries', q => q.or(mine(p))),
  ]);
  const ids = orders.map(o => o.id as string);
  const refunds: Row[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    refunds.push(...await select('ol_refunds', q => q.in('order_id', ids.slice(i, i + 200)),
      'order_id, amount, reason, method, status, reference, created_at, processed_at'));
  }
  const [checkouts, consents, requests] = await Promise.all([
    (await tableReady('ol_checkouts')) ? select('ol_checkouts', q => q.or(mine(p))) : [],
    (await tableReady('ol_consents')) ? select('ol_consents', q => q.eq('user_id', p.userId), 'purpose, granted, notice_version, source, given_at, created_at') : [],
    (await tableReady('ol_privacy_requests')) ? select('ol_privacy_requests', q => q.eq('user_id', p.userId)) : [],
  ]);
  // Before 0027, privacy requests wait in the help-request queue under "privacy:<reference>".
  const own = (s: Row) => !isLaunch(s);
  return {
    orders: orders.map(clean), checkouts: checkouts.map(clean), refunds,
    support_requests: support.filter(own).map(clean), launch_requests: support.filter(isLaunch).map(clean),
    booking_enquiries: enquiries.map(clean), consents: consents.map(clean), privacy_requests: requests.map(clean),
  };
}

export async function exportMyData(request: Request) {
  const p = await person(request, 'download your data');
  limit(p.tag, 'privacy-export', 5, 3_600_000);
  const records = dbConfigured() ? await recordsFromDatabase(p) : recordsFromMemory(p);
  const counts = Object.fromEntries(Object.entries(records).map(([k, v]) => [k, v.length]));
  const receipt = await saveRequest(p, 'export', 'completed', { counts }, null);
  audit('export', p, { reference: receipt.reference, stored: receipt.stored, ...counts });
  return {
    about: {
      what: `Everything ${PRIVACY.brand} holds about you on its servers, as of the time below.`,
      generated_at: new Date().toISOString(), reference: receipt.reference, notice_version: PRIVACY.noticeVersion,
      data_fiduciary: PRIVACY.legalEntity, grievance_officer: PRIVACY.grievanceOfficer, respond_within_days: PRIVACY.responseDays,
    },
    account: await accountOf(p),
    ...records,
    what_we_collect_and_why: NOTICE_ITEMS,
    shared_with: SHARED_WITH,
    kept_by_law_after_deletion: KEPT_BY_LAW,
    not_in_this_file: [
      'Card numbers, UPI PINs and bank logins: we never receive them. Razorpay holds your payment details under its own licence.',
      'Your password: Supabase keeps only a one-way scrambled form that no one can read back.',
      'Security logs: kept for one year; they carry no names or contact details.',
      'What is saved only on your phone (profile extras, saved addresses, wishlist, cart, recent places): the app adds it to this file under "on_this_phone".',
    ],
  };
}

// ---------- Consents ----------
// Every choice is a new row (never an update), with the notice version shown and where it was made.
// A choice made while signed out is kept on the phone and sent after sign-in; `at` is when the phone
// recorded it (kept as given_at, next to the server's own created_at).
const NOTICE_VERSION = /^\d{4}-\d{2}-\d{2}\.\d{1,3}$/;
type ConsentInput = { purpose?: unknown; granted?: unknown; notice_version?: unknown; source?: unknown; at?: unknown };

function readConsent(raw: unknown): Omit<ConsentRecord, 'user_id' | 'created_at'> {
  const c = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as ConsentInput;
  if (!(RECORDED_PURPOSES as readonly unknown[]).includes(c.purpose)) throw new HttpError(400, 'Unknown consent purpose.');
  if (typeof c.granted !== 'boolean') throw new HttpError(400, 'Say whether consent is given or withdrawn.');
  if (typeof c.notice_version !== 'string' || !NOTICE_VERSION.test(c.notice_version)) throw new HttpError(400, 'Please update the app and try again.');
  if (!(CONSENT_SOURCES as readonly unknown[]).includes(c.source)) throw new HttpError(400, 'Please update the app and try again.');
  // Declarations are only ever made, never "withdrawn": un-confirming your age is not a thing.
  if ((c.purpose === 'notice_acknowledged' || c.purpose === 'age_18_plus') && !c.granted) throw new HttpError(400, 'This can only be confirmed.');
  const at = typeof c.at === 'string' ? Date.parse(c.at) : NaN;
  const plausible = Number.isFinite(at) && at > Date.now() - 365 * DAY && at < Date.now() + 5 * 60_000;
  return {
    purpose: c.purpose as ConsentPurpose, granted: c.granted, notice_version: c.notice_version, source: c.source as string,
    given_at: plausible ? new Date(at).toISOString() : null,
  };
}

export async function recordConsents(request: Request) {
  const p = await person(request, 'save your privacy choices');
  limit(p.tag, 'privacy-consents', 30, 3_600_000);
  const body = await readBody<{ consents?: unknown }>(request);
  if (!Array.isArray(body.consents) || body.consents.length < 1 || body.consents.length > 20) throw new HttpError(400, 'Send between 1 and 20 choices.');
  const now = new Date().toISOString();
  const rows: ConsentRecord[] = body.consents.map(readConsent).map(c => ({ ...c, user_id: p.userId, created_at: now }));

  let stored: 'memory' | 'database' | 'phone_only' = 'memory';
  if (!dbConfigured()) mem.consents.push(...rows);
  else if (await tableReady('ol_consents')) {
    const { error } = await db().from('ol_consents').insert(rows);
    if (error) fromDbError(error);
    stored = 'database';
  } else stored = 'phone_only'; // before 0027: the phone keeps them and sends them again later
  audit('consents', p, { stored, count: rows.length, purposes: rows.map(r => `${r.purpose}:${r.granted ? 'on' : 'off'}`).join(' ') });
  return { recorded: stored === 'phone_only' ? 0 : rows.length, stored, notice_version: PRIVACY.noticeVersion };
}

// The newest choice per purpose, so a phone the person has just signed in on shows their choices.
export async function currentConsents(request: Request) {
  const p = await person(request, 'see your privacy choices');
  limit(p.tag, 'privacy-read', 60, 3_600_000);
  // Newest first; within one request, the later choice in the list wins (append order).
  let rows: ConsentRecord[] = [];
  if (!dbConfigured()) rows = mem.consents.filter(c => c.user_id === p.userId).reverse();
  else if (await tableReady('ol_consents')) {
    const { data, error } = await db().from('ol_consents').select('user_id, purpose, granted, notice_version, source, given_at, created_at')
      .eq('user_id', p.userId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1000);
    if (error) fromDbError(error);
    rows = (data ?? []) as ConsentRecord[];
  }
  const newest = new Map<string, ConsentRecord>();
  for (const r of rows) if (!newest.has(r.purpose)) newest.set(r.purpose, r);
  return {
    notice_version: PRIVACY.noticeVersion,
    consents: [...newest.values()].map(r => ({ purpose: r.purpose, granted: r.granted, notice_version: r.notice_version, at: r.given_at ?? r.created_at })),
  };
}

// ---------- Erasure (delete my account) ----------
// What can go, goes: booking enquiries are deleted; help-request messages are replaced; every order
// and checkout loses its delivery address and its link to the person. What tax and payment law make
// us keep (amounts, taxes, items, Razorpay references) stays, but no longer points to anyone: the
// rows get one random stand-in owner that nothing else records.
//
// The login itself (Supabase Auth) is shared by every Proviyaa app (docs/PLATFORM_FOUNDATIONS.md D1):
// the same person may be a restaurant's staff member or a rider. Deleting it is switched off unless
// PRIVACY_HARD_DELETE=on, and even then skipped while the person has another membership. Otherwise
// every session is ended now and the request waits for the team to delete the login by hand.
export type ErasureCounts = { orders_anonymised: number; checkouts_anonymised: number; refunds_unlinked: number; enquiries_deleted: number; help_requests_anonymised: number };
const ERASED_MESSAGE = 'Erased at the customer’s request.';
const hardDeleteOn = () => process.env.PRIVACY_HARD_DELETE?.trim().toLowerCase() === 'on';
const RECENT_ORDER_MS = DAY;

// An order placed in the last day that is not yet delivered or cancelled still needs its address.
async function ordersOnTheWay(p: Person): Promise<number> {
  const since = new Date(Date.now() - RECENT_ORDER_MS).toISOString();
  if (!dbConfigured()) {
    return memoryRecords().orders.filter(o => isMine(p, o) && OPEN_ORDER.includes(o.status) && o.created_at > since
      && !['pending', 'failed'].includes(o.payment_status)).length;
  }
  const { count, error } = await db().from('ol_orders').select('id', { head: true, count: 'exact' }).or(mine(p))
    .in('status', OPEN_ORDER).gt('created_at', since).not('payment_status', 'in', '(pending,failed)');
  if (error) fromDbError(error);
  return count ?? 0;
}

function eraseInMemory(p: Person, standIn: string): ErasureCounts {
  const store = memoryRecords();
  const counts: ErasureCounts = { orders_anonymised: 0, checkouts_anonymised: 0, refunds_unlinked: 0, enquiries_deleted: 0, help_requests_anonymised: 0 };
  for (const o of store.orders) if (isMine(p, o)) { Object.assign(o, { address: null, customer: standIn, user_id: null }); counts.orders_anonymised++; }
  for (const c of store.checkouts) if (isMine(p, c)) { Object.assign(c, { customer: standIn, user_id: null }); counts.checkouts_anonymised++; }
  for (let i = store.enquiries.length - 1; i >= 0; i--) if (isMine(p, store.enquiries[i])) { store.enquiries.splice(i, 1); counts.enquiries_deleted++; }
  for (const s of store.support) {
    if (!isMine(p, s) || s.reference.startsWith('privacy:')) continue;
    // A "launch here" request names a town, not a person: it stays, unlinked, so the demand still counts.
    if (!isLaunch(s)) Object.assign(s, { message: ERASED_MESSAGE, reference: '' });
    Object.assign(s, { customer: null, user_id: null });
    counts.help_requests_anonymised++;
  }
  // Remembered checkout replies (for retried requests) hold a copy of the delivery address.
  for (const key of [...store.replies.keys()]) if (p.matches.some(m => key.startsWith(`${m}:`))) store.replies.delete(key);
  return counts;
}

async function eraseInDatabase(p: Person, standIn: string): Promise<ErasureCounts> {
  const run = async (query: PromiseLike<{ data: unknown[] | null; error: { message?: string; code?: string } | null }>) => {
    const { data, error } = await query;
    if (error) fromDbError(error);
    return data?.length ?? 0;
  };
  const orders = await run(db().from('ol_orders').update({ delivery_address: null, user_id: null, customer_hash: standIn, idempotency_key: null }).or(mine(p)).select('id'));
  const checkouts = (await tableReady('ol_checkouts'))
    ? await run(db().from('ol_checkouts').update({ user_id: null, customer_hash: standIn, idempotency_key: null }).or(mine(p)).select('id')) : 0;
  const refunds = await run(db().from('ol_refunds').update({ requested_by: null }).eq('requested_by', p.userId).select('id'));
  const enquiries = await run(db().from('ol_booking_enquiries').delete().or(mine(p)).select('id'));
  const help = await run(db().from('ol_support_requests').update({ message: ERASED_MESSAGE, reference: '', user_id: null, customer_hash: null })
    .or(mine(p)).not('reference', 'like', 'launch:%').not('reference', 'like', 'privacy:%').select('id'));
  const launches = await run(db().from('ol_support_requests').update({ user_id: null, customer_hash: null }).or(mine(p)).like('reference', 'launch:%').select('id'));
  return { orders_anonymised: orders, checkouts_anonymised: checkouts, refunds_unlinked: refunds, enquiries_deleted: enquiries, help_requests_anonymised: help + launches };
}

// Other Proviyaa memberships of the same login (staff, rider, our own team). null = could not tell.
async function otherMemberships(userId: string): Promise<string[] | null> {
  const found: string[] = [];
  for (const table of ['org_users', 'riders', 'platform_admins']) {
    const { data, error } = await db().from(table).select('user_id').eq('user_id', userId).limit(1);
    if (error) { if (['PGRST205', '42P01'].includes(error.code ?? '')) continue; return null; }
    if (data?.length) found.push(table);
  }
  return found;
}

type LoginOutcome = 'deleted' | 'kept_for_review' | 'kept_other_apps';
async function endLogin(p: Person): Promise<LoginOutcome> {
  if (hardDeleteOn() && dbConfigured()) {
    const others = await otherMemberships(p.userId);
    if (others && others.length) return 'kept_other_apps';
    if (others) {
      const { error } = await db().auth.admin.deleteUser(p.userId);
      if (!error) return 'deleted';
      console.error('[privacy] login delete failed', p.tag, error.message);
    }
  }
  // Not deleted: end every session on every phone now (the app also signs out on this one).
  const { url, apikey } = authConfig();
  if (url && apikey && p.token) {
    await fetch(`${url}/auth/v1/logout?scope=global`, { method: 'POST', headers: { apikey, Authorization: `Bearer ${p.token}` }, signal: AbortSignal.timeout(5000) })
      .catch(() => null);
  }
  return 'kept_for_review';
}

export async function requestErasure(request: Request) {
  const p = await person(request, 'delete your account');
  limit(p.tag, 'privacy-erasure', 3, DAY);
  const body = await readBody<{ confirm?: unknown }>(request);
  if (body.confirm !== 'DELETE') throw new HttpError(400, 'Please confirm that you want to delete your account.');
  if (await ordersOnTheWay(p)) throw new HttpError(409, 'You have an order on its way. Once it is delivered or cancelled, you can delete your account.');

  const saved = await saveRequest(p, 'erasure', 'in_progress', { asked_at: new Date().toISOString() }, PRIVACY.responseDays);
  audit('erasure_started', p, { reference: saved.reference, stored: saved.stored });
  const standIn = `erased:${crypto.randomUUID()}`;
  const counts = dbConfigured() ? await eraseInDatabase(p, standIn) : eraseInMemory(p, standIn);
  const login = await endLogin(p);
  // Their optional consents are withdrawn too; the history stays as evidence (see KEPT_BY_LAW).
  const withdrawn: ConsentRecord[] = OPTIONAL_PURPOSES.map(purpose => ({ purpose, granted: false, notice_version: PRIVACY.noticeVersion, source: 'privacy_screen', given_at: null, user_id: p.userId, created_at: new Date().toISOString() }));
  if (!dbConfigured()) mem.consents.push(...withdrawn);
  else if (await tableReady('ol_consents')) { const { error } = await db().from('ol_consents').insert(withdrawn); if (error) fromDbError(error); }

  const status: RequestStatus = login === 'deleted' ? 'completed' : 'partially_completed';
  const done = await updateRequest(saved, { status, resolved_at: status === 'completed' ? new Date().toISOString() : null, details: { ...saved.details, outcome: { ...counts, login } } });
  audit('erasure_done', p, { reference: done.reference, status, login, ...counts });
  return {
    reference: done.reference, status, erased: counts, login,
    kept: KEPT_BY_LAW,
    message: login === 'deleted'
      ? 'Your account and personal details have been deleted. Records the law makes us keep no longer point to you.'
      : `Your personal details have been removed and you are signed out everywhere. Our team will close your login within ${PRIVACY.responseDays} days; quote ${done.reference} if you contact us.`,
  };
}

// ---------- Grievances and correction requests ----------
// s.13: a person must be able to complain to us first, and we answer within the published period
// (PRIVACY.responseDays, at most 90 days under Rule 14). A correction request is the same form for
// things the person cannot fix in the app themselves (their profile they can edit directly).
const ABOUT = ['consent', 'access', 'correction', 'erasure', 'marketing', 'security', 'other'] as const;

function answerBy(saved: Saved) {
  return {
    reference: saved.reference, kind: saved.kind, status: saved.status, due_at: saved.due_at, respond_within_days: PRIVACY.responseDays,
    contact: { name: PRIVACY.grievanceOfficer.name, email: PRIVACY.grievanceOfficer.email, phone: PRIVACY.grievanceOfficer.phone },
    board: PRIVACY.board.name,
  };
}

export async function raiseGrievance(request: Request) {
  const p = await person(request, 'raise a privacy concern');
  limit(p.tag, 'privacy-grievance', 5, DAY);
  const b = await readBody<{ message?: unknown; kind?: unknown; about?: unknown }>(request);
  const kind: RequestKind = b.kind === 'correction' ? 'correction' : 'grievance';
  const about = (ABOUT as readonly unknown[]).includes(b.about) ? (b.about as string) : kind === 'correction' ? 'correction' : 'other';
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (message.length < 10 || message.length > 2000) throw new HttpError(400, 'Please describe it in 10 to 2,000 characters.');
  const saved = await saveRequest(p, kind, 'received', { about, message }, PRIVACY.responseDays);
  audit(kind, p, { reference: saved.reference, stored: saved.stored, about });
  return answerBy(saved);
}

// ---------- Nomination ----------
// s.14: someone who can use these rights for the person if they die or cannot act. Recorded as a
// request the team confirms; a newer nomination replaces an older one.
const RELATIONSHIPS = ['spouse', 'parent', 'child', 'sibling', 'relative', 'friend', 'other'] as const;

export async function nominate(request: Request) {
  const p = await person(request, 'nominate someone');
  limit(p.tag, 'privacy-nominee', 5, DAY);
  const b = await readBody<{ name?: unknown; relationship?: unknown; phone?: unknown; email?: unknown }>(request);
  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : '';
  if (name.length < 2 || name.length > 80) throw new HttpError(400, 'Enter your nominee’s full name.');
  if (!(RELATIONSHIPS as readonly unknown[]).includes(b.relationship)) throw new HttpError(400, 'Choose how your nominee is related to you.');
  const phone = typeof b.phone === 'string' ? b.phone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '') : '';
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (phone && !/^[6-9]\d{9}$/.test(phone)) throw new HttpError(400, 'Enter a valid 10-digit mobile number for your nominee.');
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new HttpError(400, 'Enter a valid email for your nominee.');
  if (!phone && !email) throw new HttpError(400, 'Give a mobile number or an email so we can reach your nominee.');
  const saved = await saveRequest(p, 'nominee', 'received', { nominee: { name, relationship: b.relationship, phone: phone || null, email: email || null } }, PRIVACY.responseDays);
  audit('nominee', p, { reference: saved.reference, stored: saved.stored });
  return answerBy(saved);
}
