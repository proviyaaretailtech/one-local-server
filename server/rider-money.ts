// The rider's money, read from the ledger tables: earnings, history, cash in hand, cash deposits, the wallet and
// payout requests. Every amount in the database is an integer in minor units (paise); the app shows rupees, so
// each amount passes through fromMinor/toMinor exactly once, here.
// Nothing in this file moves money. A cash deposit is recorded as PENDING (operations confirms it, and the database
// then writes the cash ledger); a withdrawal is recorded as a PENDING payouts row (operations approves and pays).
import { z } from 'zod';
import { distanceKm } from './catalog';
import { db, fromDbError, rpc } from './db';
import { displayState } from './dispatch';
import { HttpError } from './http';
import type { Rider } from './rider';
import { afterCursor, decodeCursor, encodeCursor, fromMinor, PAGE, parse, notFound, riderPolicy, toMinor, uuidParam } from './rider-extra';

type Row = Record<string, any>;

// ---------- time: the rider's day is the Indian day (UTC+5:30, no daylight saving) ----------
const IST_MS = 330 * 60_000, DAY = 86_400_000;
const istStart = (ts: number) => Math.floor((ts + IST_MS) / DAY) * DAY - IST_MS; // 00:00 IST of that day, as a UTC time
const dayKey = (ts: number) => new Date(ts + IST_MS).toISOString().slice(0, 10);
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const istParts = (ts: number) => { const d = new Date(ts + IST_MS); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() }; };

// Reads a table past PostgREST's 1,000-row page. Capped so one rider cannot make a request unbounded.
async function all(build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>, cap = 20_000): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) fromDbError(error);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return out;
}

// ---------- earnings ----------

const rangeSchema = z.enum(['today', 'week', 'month']);

// GET /rider/earnings?range=today|week|month. The split follows the ledger's kinds: delivery_fee (+ cash
// adjustments) is order pay, bonus is milestone bonus, tip is tips. The ledger holds no peak or distance breakdown.
export async function earnings(rider: Rider, rangeRaw: string | null) {
  const range = parse(rangeSchema, rangeRaw ?? 'today');
  const now = Date.now(), today = istStart(now), p = istParts(now);
  let start = today, days = 1, label = 'Today';
  if (range === 'week') {
    start = today - ((p.wd + 6) % 7) * DAY; days = 7;
    const end = istParts(start + 6 * DAY);
    label = `${istParts(start).d} ${MONTH[istParts(start).m]} – ${end.d} ${MONTH[end.m]}`;
  } else if (range === 'month') {
    start = Date.UTC(p.y, p.m, 1) - IST_MS; // first of the month, IST midnight
    days = new Date(Date.UTC(p.y, p.m + 1, 0)).getUTCDate();
    label = `${MONTH_LONG[p.m]} ${p.y}`;
  }
  const end = start + days * DAY;
  const rows = await all((a, b) => db().from('rider_earnings').select('kind, amount_minor, currency_code, delivery_job_id, created_at')
    .eq('rider_id', rider.id).gte('created_at', new Date(start).toISOString()).lt('created_at', new Date(end).toISOString()).order('created_at').range(a, b));

  const split = { order_pay: 0, milestone_bonus: 0, tips: 0, peak_incentive: 0 };
  const perDay = new Map<string, { total: number; jobs: Set<string> }>();
  const jobs = new Set<string>();
  let total = 0;
  for (const r of rows) {
    const amount = fromMinor(r.amount_minor, r.currency_code);
    total += amount;
    if (r.kind === 'tip') split.tips += amount; else if (r.kind === 'bonus') split.milestone_bonus += amount; else split.order_pay += amount;
    const key = dayKey(Date.parse(r.created_at));
    const d = perDay.get(key) ?? { total: 0, jobs: new Set<string>() };
    d.total += amount;
    if (r.kind === 'delivery_fee' && r.delivery_job_id) { d.jobs.add(r.delivery_job_id); jobs.add(r.delivery_job_id); }
    perDay.set(key, d);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const series = Array.from({ length: days }, (_, i) => {
    const ts = start + i * DAY, key = dayKey(ts), d = perDay.get(key);
    return { date: key, label: range === 'month' ? String(istParts(ts).d) : WEEKDAY[istParts(ts).wd], total: r2(d?.total ?? 0), jobs: d?.jobs.size ?? 0 };
  });
  return {
    range, total: r2(total), deliveries: jobs.size, average_per_trip: jobs.size ? r2(total / jobs.size) : 0,
    split: { order_pay: r2(split.order_pay), milestone_bonus: r2(split.milestone_bonus), tips: r2(split.tips), peak_incentive: 0 },
    series, insights: [], period_label: label, rule_version: 1,
  };
}

// One delivery as the history list shows it (camelCase: the app uses it as is).
async function historyItem(job: Row, earned: number) {
  const failed = job.status === 'exception' && ['failed', 'returned'].includes(job.step);
  return {
    id: job.id, orderRef: job.order_no ?? '', state: displayState(job), category: 'on_order', pickupName: job.pickup_name, dropArea: job.drop_area ?? '',
    distanceKm: Math.round(distanceKm({ lat: job.pickup_lat, lng: job.pickup_lng }, { lat: job.drop_lat, lng: job.drop_lng }) * 10) / 10,
    earnings: earned, deliveredAt: job.delivered_at ?? undefined, createdAt: job.created_at,
    failureReason: job.status === 'cancelled' ? (job.cancel_reason ?? 'Cancelled') : failed ? (job.exception_kind ?? 'Not delivered') : undefined,
  };
}

async function jobEarnedMinor(riderId: string, jobIds: string[]) {
  const per = new Map<string, { base: number; tip: number; bonus: number; adj: number; currency: string }>();
  if (!jobIds.length) return per;
  const { data, error } = await db().from('rider_earnings').select('delivery_job_id, kind, amount_minor, currency_code').eq('rider_id', riderId).in('delivery_job_id', jobIds);
  if (error) fromDbError(error);
  for (const r of data ?? []) {
    const e = per.get(r.delivery_job_id) ?? { base: 0, tip: 0, bonus: 0, adj: 0, currency: r.currency_code };
    const v = Number(r.amount_minor);
    if (r.kind === 'tip') e.tip += v; else if (r.kind === 'bonus') e.bonus += v; else if (r.kind === 'cash_adjustment') e.adj += v; else e.base += v;
    per.set(r.delivery_job_id, e);
  }
  return per;
}

// GET /rider/earnings/jobs/:id
export async function jobEarnings(rider: Rider, jobId: string) {
  uuidParam(jobId, 'Job');
  const { data: job, error } = await db().from('delivery_jobs').select('*').eq('id', jobId).eq('rider_id', rider.id).maybeSingle();
  if (error) fromDbError(error);
  if (!job) throw notFound('Job');
  const e = (await jobEarnedMinor(rider.id, [jobId])).get(jobId) ?? { base: 0, tip: 0, bonus: 0, adj: 0, currency: job.currency_code ?? 'INR' };
  const m = (n: number) => fromMinor(n, e.currency);
  const total = m(e.base + e.adj + e.tip + e.bonus);
  return {
    earnings: {
      job_id: job.id, base: m(e.base + e.adj), distance: 0, peak: 0, wait: 0, tip: m(e.tip), bonus: m(e.bonus), total, rule_version: 1,
      distance_km: Math.round(distanceKm({ lat: job.pickup_lat, lng: job.pickup_lng }, { lat: job.drop_lat, lng: job.drop_lng }) * 10) / 10,
      created_at: job.delivered_at ?? job.created_at,
    },
    job: await historyItem(job, total),
  };
}

// GET /rider/jobs?cursor=  (history: finished deliveries, newest first)
export async function jobHistory(rider: Rider, cursor: string | null) {
  const c = decodeCursor(cursor);
  let q = db().from('delivery_jobs').select('*').eq('rider_id', rider.id).in('status', ['delivered', 'cancelled', 'exception'])
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE + 1);
  if (c) q = q.or(afterCursor(c));
  const { data, error } = await q;
  if (error) fromDbError(error);
  const rows = data ?? [];
  const page = rows.slice(0, PAGE);
  // A job held for a problem is still live; only a closed one (failed or returned) belongs in the history.
  const done = page.filter(j => j.status !== 'exception' || ['failed', 'returned'].includes(j.step));
  const per = await jobEarnedMinor(rider.id, done.map(j => j.id));
  const items = await Promise.all(done.map(j => {
    const e = per.get(j.id);
    return historyItem(j, e ? fromMinor(e.base + e.adj + e.tip + e.bonus, e.currency) : 0);
  }));
  return { items, next_cursor: rows.length > PAGE ? encodeCursor(page[page.length - 1] as any) : null };
}

// ---------- cash in hand ----------

async function riderMoneyRow(riderId: string) {
  const { data, error } = await db().from('riders').select('cash_limit, cash_limit_minor').eq('id', riderId).single();
  if (error) fromDbError(error);
  return data as Row;
}
// A rider with no limit of their own is held to the city's default (rider_policies), so "no limit" never means "unlimited cash".
const cashLimitMinor = (r: Row, defaultMinor: number) => Number(r.cash_limit_minor ?? (r.cash_limit != null ? Math.round(Number(r.cash_limit) * 100) : defaultMinor));
const inHandMinor = async (riderId: string) => Number(await rpc<number>('rider_cash_in_hand_minor', { p_rider: riderId }));

const LEDGER_KIND: Record<string, string> = { collected: 'collected', deposit: 'deposited', adjustment: 'adjustment' };

// GET /rider/cash
export async function cash(rider: Rider) {
  const [rowInfo, inHand, policy, entries] = await Promise.all([
    riderMoneyRow(rider.id), inHandMinor(rider.id), riderPolicy(rider.id),
    db().from('rider_cash_entries').select('id, delivery_job_id, kind, amount_minor, currency_code, reference, created_at').eq('rider_id', rider.id).order('created_at', { ascending: false }).limit(50),
  ]);
  if (entries.error) fromDbError(entries.error);
  return {
    cash_in_hand: fromMinor(inHand), cash_limit: fromMinor(cashLimitMinor(rowInfo, policy.defaultCashLimitMinor)),
    ledger: (entries.data ?? []).map(e => ({ id: e.id, job_id: e.delivery_job_id ?? undefined, kind: LEDGER_KIND[e.kind] ?? 'adjustment', amount: fromMinor(e.amount_minor, e.currency_code), created_at: e.created_at, note: e.reference ?? undefined })),
    deposit_instructions: 'Hand the cash you collected to your store or to One Local operations, then record it here. Your balance drops when operations confirms the deposit.',
    upi_deposit: null, // paying cash in online needs a payment provider, which is not set up
  };
}

const depositStatus: Record<string, string> = { pending: 'pending', confirmed: 'paid', rejected: 'failed' };
const depositDto = (d: Row) => ({
  id: d.id, amount: fromMinor(d.amount_minor, d.currency_code), status: depositStatus[d.status] ?? 'pending', checkout_url: null, expires_at: null,
  reference: d.reference ?? null, method: 'cash', created_at: d.created_at, paid_at: d.status === 'confirmed' ? d.updated_at : null,
});

const amountBody = z.object({ amount: z.number().finite().positive().max(1_000_000) });
const isUnique = (e: any) => e?.code === '23505';

// POST /rider/cash/deposits {amount}. Idempotent per Idempotency-Key. Creates a PENDING record only.
export async function createCashDeposit(rider: Rider, raw: unknown, key: string) {
  const { amount } = parse(amountBody, raw);
  const minor = toMinor(amount);
  if (minor < 1) throw new HttpError(400, 'amount: too small', undefined, 'validation');
  const existing = await db().from('rider_cash_deposits').select('*').eq('rider_id', rider.id).eq('idempotency_key', key).maybeSingle();
  if (existing.error) fromDbError(existing.error);
  if (existing.data) return replayOrMismatch(existing.data, minor);
  const [inHand, pending] = await Promise.all([
    inHandMinor(rider.id),
    db().from('rider_cash_deposits').select('amount_minor').eq('rider_id', rider.id).eq('status', 'pending'),
  ]);
  const waiting = (pending.data ?? []).reduce((s, d) => s + Number(d.amount_minor), 0);
  if (minor > inHand - waiting) throw new HttpError(422, 'You cannot deposit more than the cash you are holding.', undefined, 'validation');
  const { data, error } = await db().from('rider_cash_deposits').insert({ rider_id: rider.id, amount_minor: minor, currency_code: 'INR', status: 'pending', idempotency_key: key }).select('*').single();
  if (error) {
    if (!isUnique(error)) fromDbError(error);
    const again = await db().from('rider_cash_deposits').select('*').eq('rider_id', rider.id).eq('idempotency_key', key).single();
    return replayOrMismatch(again.data as Row, minor);
  }
  return { body: depositDto(data), replayed: false };
}
function replayOrMismatch(row: Row, minor: number) {
  if (Number(row.amount_minor) !== minor) throw new HttpError(422, 'That Idempotency-Key was already used for a different amount.', undefined, 'idempotency_mismatch');
  return { body: depositDto(row), replayed: true };
}

// GET /rider/cash/deposits/:id
export async function getCashDeposit(rider: Rider, id: string) {
  uuidParam(id, 'Deposit');
  const { data, error } = await db().from('rider_cash_deposits').select('*').eq('id', id).eq('rider_id', rider.id).maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw notFound('Deposit');
  return depositDto(data);
}

// ---------- wallet and payouts ----------

const PAYOUT_STATUS: Record<string, string> = { pending: 'processing', approved: 'processing', paid: 'success', failed: 'failed' };
const payoutDto = (p: Row) => {
  const amount = fromMinor(p.amount_minor, p.currency_code);
  return {
    id: p.id, kind: 'instant', mode: 'imps', amount, fee: 0, net: amount, status: PAYOUT_STATUS[p.status] ?? 'processing',
    utr: p.status === 'paid' && p.reference ? p.reference : null,
    status_description: p.status === 'failed' ? 'The payout could not be completed. The amount is back in your balance.' : null,
    destination: 'Your registered payout account', period_label: null, created_at: p.created_at, completed_at: p.status === 'paid' ? p.updated_at : null,
  };
};
const riderPayouts = (riderId: string) => db().from('payouts').select('*').eq('payee_type', 'rider').eq('payee_id', riderId);

async function balances(riderId: string) {
  const [earned, payouts] = await Promise.all([
    all((a, b) => db().from('rider_earnings').select('amount_minor').eq('rider_id', riderId).order('created_at').order('id').range(a, b), 100_000),
    all((a, b) => riderPayouts(riderId).select('status, amount_minor, created_at').order('created_at').order('id').range(a, b), 100_000),
  ]);
  const sum = (rows: Row[]) => rows.reduce((s, r) => s + Number(r.amount_minor), 0);
  const inFlight = sum(payouts.filter(p => p.status === 'pending' || p.status === 'approved'));
  const taken = inFlight + sum(payouts.filter(p => p.status === 'paid'));
  const dayStart = istStart(Date.now());
  const today = payouts.filter(p => p.status !== 'failed' && Date.parse(p.created_at) >= dayStart).length;
  return { balance: Math.max(0, sum(earned) - taken), raw: sum(earned) - taken, inFlight, today };
}

async function blockedReason(riderId: string) {
  const [info, inHand, policy] = await Promise.all([riderMoneyRow(riderId), inHandMinor(riderId), riderPolicy(riderId)]);
  return inHand >= cashLimitMinor(info, policy.defaultCashLimitMinor) ? 'Deposit the cash you are holding before you withdraw.' : null;
}

// The rider's saved payout account as the app shows it. Only the kind and a masked display are ever stored (payout_accounts).
export const payoutMethodDto = (a: Row) => ({
  id: a.rider_id, method: a.kind,
  ...(a.kind === 'upi' ? { vpa: a.display_masked } : { account_last4: String(a.display_masked).replace(/\D/g, '').slice(-4) }),
  status: a.verified ? 'verified' : 'pending', is_primary: true,
});
async function payoutAccount(riderId: string) {
  const { data, error } = await db().from('payout_accounts').select('rider_id, kind, display_masked, verified').eq('rider_id', riderId).maybeSingle();
  if (error) fromDbError(error);
  return data ? payoutMethodDto(data) : null;
}

// GET /rider/wallet. balance = everything earned minus everything already paid or requested.
export async function wallet(rider: Rider) {
  const [b, blocked, policy, method, recent] = await Promise.all([
    balances(rider.id), blockedReason(rider.id), riderPolicy(rider.id), payoutAccount(rider.id),
    riderPayouts(rider.id).order('created_at', { ascending: false }).limit(5),
  ]);
  if (recent.error) fromDbError(recent.error);
  const d = istParts(Date.now()), nextMonday = Date.UTC(d.y, d.m, d.d) + (((8 - d.wd) % 7) || 7) * DAY - IST_MS;
  return {
    balance: fromMinor(b.balance), available: blocked ? 0 : fromMinor(b.balance), in_flight: fromMinor(b.inFlight),
    instant: {
      enabled: true, min_amount: fromMinor(policy.withdrawMinMinor), max_amount: fromMinor(policy.withdrawMaxMinor), fee: 0,
      withdrawals_left_today: Math.max(0, policy.withdrawPerDay - b.today), blocked_reason: blocked,
    },
    weekly: { next_payout_at: new Date(nextMonday).toISOString(), description: 'Withdrawal requests are checked and paid by One Local operations.' },
    payout_method: method,
    recent: (recent.data ?? []).map(payoutDto),
  };
}

// GET /rider/payouts?cursor=
export async function listPayouts(rider: Rider, cursor: string | null) {
  const c = decodeCursor(cursor);
  let q = riderPayouts(rider.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE + 1);
  if (c) q = q.or(afterCursor(c));
  const { data, error } = await q;
  if (error) fromDbError(error);
  const rows = data ?? [], page = rows.slice(0, PAGE);
  return { items: page.map(payoutDto), next_cursor: rows.length > PAGE ? encodeCursor(page[page.length - 1] as any) : null };
}

// GET /rider/payouts/:id
export async function getPayout(rider: Rider, id: string) {
  uuidParam(id, 'Payout');
  const { data, error } = await riderPayouts(rider.id).eq('id', id).maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw notFound('Payout');
  return payoutDto(data);
}

// POST /rider/payouts/withdraw {amount}. Records a PENDING request. No money moves and no provider is called.
// The same Idempotency-Key is the same tap: payouts has a unique index on (payee_type, payee_id, idempotency_key), so a
// repeat (even a simultaneous one) returns the payout that already exists instead of making a second.
export async function withdraw(rider: Rider, raw: unknown, key: string) {
  const { amount } = parse(amountBody, raw);
  const minor = toMinor(amount);
  const existing = async () => {
    const r = await riderPayouts(rider.id).eq('idempotency_key', key).maybeSingle();
    if (r.error) fromDbError(r.error);
    if (!r.data) return null;
    if (Number(r.data.amount_minor) !== minor) throw new HttpError(422, 'That Idempotency-Key was already used for a different amount.', undefined, 'idempotency_mismatch');
    return { body: payoutDto(r.data), replayed: true };
  };
  const prior = await existing();
  if (prior) return prior;
  if (!(await payoutAccount(rider.id))) throw new HttpError(422, 'Add a payout account before you withdraw.', undefined, 'no_payout_account');
  const policy = await riderPolicy(rider.id);
  if (minor < policy.withdrawMinMinor) throw new HttpError(422, `The smallest withdrawal is ₹${fromMinor(policy.withdrawMinMinor)}.`, undefined, 'validation');
  if (minor > policy.withdrawMaxMinor) throw new HttpError(422, `The largest withdrawal is ₹${fromMinor(policy.withdrawMaxMinor)}.`, undefined, 'validation');
  const blocked = await blockedReason(rider.id);
  if (blocked) throw new HttpError(403, blocked, undefined, 'payout_blocked');
  const b = await balances(rider.id);
  if (b.today >= policy.withdrawPerDay) throw new HttpError(403, 'You have reached today\'s withdrawal limit.', undefined, 'payout_blocked');
  const insufficient = (available: number) => Object.assign(new HttpError(422, 'That is more than your available balance.', undefined, 'insufficient_balance'), { extra: { available: fromMinor(available) } });
  if (minor > b.balance) throw insufficient(b.balance);
  const { data, error } = await db().from('payouts').insert({ payee_type: 'rider', payee_id: rider.id, amount_minor: minor, currency_code: 'INR', status: 'pending', idempotency_key: key }).select('*').single();
  if (error) {
    if (String(error.message ?? '').startsWith('PAYOUT_EXCEEDS_BALANCE')) throw insufficient((await balances(rider.id)).balance); // database guard (migration 0118): concurrent taps cannot overdraw
    if (!isUnique(error)) fromDbError(error);
    const again = await existing(); // two taps at once with one key: the other one won
    if (again) return again;
    fromDbError(error);
  }
  // Two DIFFERENT keys at once could both have passed the balance check above. Look again now that our row exists;
  // if the rider has been over-committed (or past the daily count), withdraw our own brand-new pending row.
  const after = await balances(rider.id);
  if (after.raw < 0 || after.today > policy.withdrawPerDay) {
    await db().from('payouts').delete().eq('id', data.id).eq('status', 'pending');
    throw insufficient(Math.max(0, after.raw + minor));
  }
  return { body: payoutDto(data), replayed: false };
}
