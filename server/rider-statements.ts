// The rider's weekly earnings statement (GET /rider/statements/:week, POST /rider/statements/:week/email).
// :week is an ISO week id like 2026-W39 (what the rider app sends: features/earnings/week.ts isoWeekOf). The app opens
// `/rider/statements/2026-W39.pdf`, so a trailing `.pdf` is accepted and answers with a PDF; without it the answer is JSON.
// The week is Monday 00:00 to Sunday 24:00 Indian time, the same day the earnings screen uses. Every figure is read from
// rider_earnings and SIGNED: a forced-cancelled delivered order writes a negative cash_adjustment (migration 0218), and the
// statement must show it, not hide it. Amounts leave the database as paise and are shown as rupees, once, here.
// Nothing here moves money.
import { db, fromDbError } from './db';
import { HttpError } from './http';
import type { Rider } from './rider';
import { fromMinor } from './rider-extra';

type Row = Record<string, any>;
const IST_MS = 330 * 60_000, DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const KINDS = ['delivery_fee', 'tip', 'bonus', 'cash_adjustment'] as const;

// "2026-W39" (optionally with ".pdf") -> { week, start (UTC ms of Monday 00:00 IST) }. Anything else is a 404.
export function parseWeek(raw: string): { week: string; start: number; pdf: boolean } {
  const m = /^(\d{4})-W(\d{2})(\.pdf)?$/.exec(raw ?? '');
  const year = m ? Number(m[1]) : 0, wk = m ? Number(m[2]) : 0;
  if (!m || wk < 1 || wk > 53 || year < 2000 || year > 2100) throw new HttpError(404, 'Statement not found', undefined, 'not_found');
  const jan4 = Date.UTC(year, 0, 4); // ISO week 1 always contains 4 January
  const wd = new Date(jan4).getUTCDay() || 7;
  const monday = jan4 - (wd - 1) * DAY + (wk - 1) * DAY * 7;
  // 53 only exists in some years: week 53 of a year that has 52 would land in the next year's week 1.
  if (new Date(monday + 3 * DAY).getUTCFullYear() !== year) throw new HttpError(404, 'Statement not found', undefined, 'not_found');
  return { week: `${m[1]}-W${m[2]}`, start: monday - IST_MS, pdf: !!m[3] };
}

const dayLabel = (ts: number) => new Date(ts + IST_MS).toISOString().slice(0, 10);

export async function statement(rider: Rider, weekRaw: string) {
  const { week, start } = parseWeek(weekRaw);
  const end = start + 7 * DAY;
  const rows: Row[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await db().from('rider_earnings').select('id, kind, amount_minor, currency_code, delivery_job_id, created_at')
      .eq('rider_id', rider.id).gte('created_at', new Date(start).toISOString()).lt('created_at', new Date(end).toISOString())
      .order('created_at').order('id').range(from, from + 999);
    if (error) fromDbError(error);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  const byKind: Record<string, number> = Object.fromEntries(KINDS.map(k => [k, 0]));
  const perDay = new Map<string, { total: number; deliveries: Set<string> }>();
  const deliveries = new Set<string>();
  let totalMinor = 0;
  for (const r of rows) {
    const v = Number(r.amount_minor); // signed: reversals are negative
    totalMinor += v; byKind[r.kind] = (byKind[r.kind] ?? 0) + v;
    const key = dayLabel(Date.parse(r.created_at)), day = perDay.get(key) ?? { total: 0, deliveries: new Set<string>() };
    day.total += v;
    if (r.kind === 'delivery_fee' && r.delivery_job_id) { day.deliveries.add(r.delivery_job_id); deliveries.add(r.delivery_job_id); }
    perDay.set(key, day);
  }
  const cur = rows[0]?.currency_code ?? 'INR';
  const m = (n: number) => r2(fromMinor(n, cur));
  return {
    week, rider: { id: rider.id, name: rider.name }, currency: cur,
    period: { from: dayLabel(start), to: dayLabel(end - DAY), timezone: 'Asia/Kolkata' },
    totals: { total: m(totalMinor), deliveries: deliveries.size, delivery_fees: m(byKind.delivery_fee), tips: m(byKind.tip), bonus: m(byKind.bonus), cash_adjustments: m(byKind.cash_adjustment) },
    days: Array.from({ length: 7 }, (_, i) => { const k = dayLabel(start + i * DAY), d = perDay.get(k); return { date: k, total: m(d?.total ?? 0), deliveries: d?.deliveries.size ?? 0 }; }),
    lines: rows.map(r => ({ at: r.created_at, kind: r.kind, job_id: r.delivery_job_id ?? null, amount: m(Number(r.amount_minor)) })),
    generated_at: new Date().toISOString(),
  };
}

// A one-page PDF built by hand (no library on the server): enough for a rider to read and keep. Text is ASCII only.
export function statementPdf(s: Awaited<ReturnType<typeof statement>>): Uint8Array {
  const esc = (t: string) => t.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
  const rs = (n: number) => `${n < 0 ? '-' : ''}Rs ${Math.abs(n).toFixed(2)}`;
  const lines = [
    `One Local - Weekly earnings statement ${s.week}`, `${s.rider.name} | ${s.period.from} to ${s.period.to} (IST)`, '',
    `Total earned          ${rs(s.totals.total)}`, `Deliveries            ${s.totals.deliveries}`, `Delivery fees         ${rs(s.totals.delivery_fees)}`,
    `Tips                  ${rs(s.totals.tips)}`, `Bonus                 ${rs(s.totals.bonus)}`, `Cash adjustments      ${rs(s.totals.cash_adjustments)}`, '',
    ...s.days.map(d => `${d.date}   ${String(d.deliveries).padStart(3)} deliveries   ${rs(d.total)}`),
  ];
  const stream = `BT /F1 11 Tf 14 TL 50 790 Td ${lines.map(l => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'];
  let out = '%PDF-1.4\n'; const at: number[] = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const mask = (e: string) => { const [u, h] = e.split('@'); return `${u.slice(0, 1)}***@${h}`; };

// POST /rider/statements/:week/email. TODO(messaging): no email provider is wired into this server (the messaging stack lives in
// the rider repo, supabase/functions/_shared). So nothing is sent. The request is QUEUED as a rider_notifications row of kind
// 'statement_email_requested' (one per rider and week; a repeat answers with the same row) for that stack to pick up, and the
// receipt says so honestly: status 'skipped', channel 'email'. The rider app reads 'sent' as success, so it will show "could not send".
export async function emailStatement(rider: Rider, weekRaw: string) {
  const { week } = parseWeek(weekRaw);
  const { data: r, error } = await db().from('riders').select('email').eq('id', rider.id).maybeSingle();
  if (error) fromDbError(error);
  const email = String(r?.email ?? '').trim();
  if (!email) throw new HttpError(422, 'Add an email address to your profile first.', undefined, 'validation'); // the app sends the rider to the profile on this code
  const { data: existing, error: e2 } = await db().from('rider_notifications').select('id, created_at').eq('rider_id', rider.id).eq('kind', 'statement_email_requested').eq('data->>week', week).limit(1);
  if (e2) fromDbError(e2);
  if (!existing?.length) {
    const ins = await db().from('rider_notifications').insert({ rider_id: rider.id, kind: 'statement_email_requested', title: `Statement ${week} requested`, body: 'We will email it as soon as email delivery is switched on.', data: { week } });
    if (ins.error) fromDbError(ins.error);
  }
  console.warn('[statement-email] no email provider is configured: queued, not sent, for rider', rider.id, week);
  return { channel: 'email', status: 'skipped', fallback_used: false, fallback_reason: 'email_not_configured', to_masked: mask(email), sent_at: new Date().toISOString(), queued: true };
}
