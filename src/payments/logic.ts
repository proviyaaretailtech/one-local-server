// Customer payment screen rules for Cashfree (docs/PAYMENTS.md "App API (Cashfree)"). Pure functions only:
// no React, no network, so scripts/payment-ui-checks.ts can test every rule. The screens are in
// src/components/payment-methods.tsx and payment-progress.tsx.

export type UpiAppId = 'google_pay' | 'phonepe' | 'paytm' | 'bhim';
export type MethodId = 'upi' | 'card' | 'netbanking' | 'cod';
// How a UPI payment is taken: the hosted Cashfree page, a UPI app opened directly (intent), a QR code, or a typed UPI ID.
export type UpiMode = 'hosted' | 'intent' | 'qr' | 'collect';
export type PayPick = { method: MethodId; mode?: UpiMode; app?: UpiAppId; vpa?: string; phone?: string };
export type LastUsed = { method: MethodId; mode?: UpiMode; app?: UpiAppId };

export type MethodsResponse = {
  provider: 'cashfree' | 'razorpay' | null; online: boolean; environment?: 'sandbox' | 'production';
  cod: { available: boolean; reason: 'over_limit' | 'disabled' | null; max_total: number | null; note?: string };
  upi: { available: boolean; hosted?: boolean; apps: UpiAppId[]; intent: boolean; qr: boolean; collect: boolean; collect_note?: string };
  card: { available: boolean; hosted?: boolean };
  netbanking: { available: boolean; hosted?: boolean };
  wallet: { available: boolean; hosted?: boolean };
};

export type Outcome = 'pending' | 'paid' | 'failed' | 'dropped' | 'expired' | 'refunded' | 'cod';
export type StatusAnswer = {
  checkout_id: string; order_id: string; order_ids?: string[]; amount: number; payment_status: string; outcome: Outcome;
  method?: string | null; message: string | null; retry_ok: boolean; poll_after_ms: number | null;
};
export type PollInfo = { status_path?: string; every_ms: number; give_up_after_ms: number };

// ── Method list ────────────────────────────────────────────────────────────────────────────────────────
export const DEFAULT_ORDER: MethodId[] = ['upi', 'card', 'netbanking', 'cod'];
export type MethodRow = { id: MethodId; available: boolean; reason: 'over_limit' | 'disabled' | null; lastUsed: boolean };

// Netbanking and wallets are one row on the screen, hosted by Cashfree; it is there if either is.
export function methodAvailable(m: MethodsResponse | null | undefined, id: MethodId): boolean {
  if (!m) return false;
  if (id === 'cod') return !!m.cod?.available;
  if (!m.online) return false;
  if (id === 'netbanking') return !!m.netbanking?.available || !!m.wallet?.available;
  return !!m[id]?.available;
}

// The rows to draw. Online methods that are off are left out. Cash on delivery is always listed (with the reason when it
// cannot be used). The method used last time is on top when it can be used; the rest keep the standard order.
export function orderMethods(m: MethodsResponse | null | undefined, last: LastUsed | null | undefined): MethodRow[] {
  if (!m) return [];
  const rows: MethodRow[] = DEFAULT_ORDER
    .filter(id => id === 'cod' || methodAvailable(m, id))
    .map(id => ({ id, available: methodAvailable(m, id), reason: id === 'cod' && !m.cod?.available ? (m.cod?.reason ?? 'disabled') : null, lastUsed: false }));
  const i = last ? rows.findIndex(r => r.id === last.method && r.available) : -1;
  if (i > 0) rows.unshift(rows.splice(i, 1)[0]);
  if (i >= 0) rows[0] = { ...rows[0], lastUsed: true };
  return rows;
}

// What is selected when the screen opens: the last-used method, else the first one that works.
export function defaultRow(rows: MethodRow[]): MethodId | null {
  return rows.find(r => r.available)?.id ?? null;
}

// The UPI ways offered on this device. A phone shows its app tiles (intent) and the hosted page; the web shows the QR
// code and the hosted page. Typing a UPI ID is never a tile: it is a small last-resort link (collect).
export function upiOptions(m: MethodsResponse, platform: 'web' | 'native'): { apps: UpiAppId[]; qr: boolean; hosted: boolean; collect: boolean } {
  const u = m.upi;
  return {
    apps: platform === 'native' && u.intent ? u.apps ?? [] : [],
    qr: platform === 'web' && !!u.qr,
    hosted: u.hosted !== false,
    collect: !!u.collect,
  };
}

// The UPI way selected when the row opens: last time's if still offered, else the first tile, else QR, else the hosted page.
export function defaultUpi(m: MethodsResponse, platform: 'web' | 'native', last?: LastUsed | null): { mode: UpiMode; app?: UpiAppId } {
  const o = upiOptions(m, platform);
  if (last?.method === 'upi') {
    if (last.mode === 'intent' && last.app && o.apps.includes(last.app)) return { mode: 'intent', app: last.app };
    if (last.mode === 'qr' && o.qr) return { mode: 'qr' };
    if (last.mode === 'hosted' && o.hosted) return { mode: 'hosted' };
  }
  if (o.apps.length) return { mode: 'intent', app: o.apps[0] };
  if (o.qr) return { mode: 'qr' };
  return { mode: 'hosted' };
}

// A typed UPI ID is never remembered (it would be a personal id in storage); anything else is.
export function toLastUsed(p: PayPick): LastUsed {
  if (p.method !== 'upi') return { method: p.method };
  if (p.mode === 'collect') return { method: 'upi', mode: 'hosted' };
  return { method: 'upi', mode: p.mode, app: p.mode === 'intent' ? p.app : undefined };
}
export function parseLastUsed(raw: string | null): LastUsed | null {
  try {
    const v = JSON.parse(raw ?? 'null');
    if (!v || !DEFAULT_ORDER.includes(v.method)) return null;
    return { method: v.method, mode: ['hosted', 'intent', 'qr'].includes(v.mode) ? v.mode : undefined, app: ['google_pay', 'phonepe', 'paytm', 'bhim'].includes(v.app) ? v.app : undefined };
  } catch { return null; }
}
export const LAST_USED_KEY = 'onecity.pay.last.v1';

// ── Inputs ─────────────────────────────────────────────────────────────────────────────────────────────
export const VPA_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
export const validVpa = (v: string) => VPA_RE.test(v.trim());
// "+91 98765 43210" -> "9876543210"; anything that is not a 10-digit Indian mobile -> ''.
export function normalizePhone(v: string | null | undefined): string {
  const d = String(v ?? '').replace(/\D/g, '');
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  return /^[6-9]\d{9}$/.test(ten) ? ten : '';
}

// The POST /payments/order body fields that come from the pick (the rest comes from the cart).
export function orderPick(p: PayPick): { payment_method: 'upi' | 'card' | 'netbanking'; upi_app: UpiAppId | null } {
  if (p.method === 'cod') throw new Error('cash on delivery is not an online order'); // i18n-ignore: developer error
  return { payment_method: p.method, upi_app: p.method === 'upi' && p.mode === 'intent' ? p.app ?? null : null };
}

// ── Pay button ─────────────────────────────────────────────────────────────────────────────────────────
// Can the Pay button be pressed? Never while a request is running (double-tap guard), never on an unavailable method,
// never with a half-filled UPI ID, and online payments need a valid mobile number.
export function payEnabled(o: { row: MethodRow | undefined; busy: boolean; mode?: UpiMode; app?: UpiAppId; vpa?: string; phone?: string; phoneOk: boolean }): boolean {
  if (o.busy || !o.row || !o.row.available) return false;
  if (o.row.id === 'cod') return true;
  if (!o.phoneOk) return false;
  if (o.row.id === 'upi') {
    if (o.mode === 'collect') return validVpa(o.vpa ?? '');
    if (o.mode === 'intent') return !!o.app;
  }
  return true;
}

// ── Outcomes ───────────────────────────────────────────────────────────────────────────────────────────
// What the progress screen shows. Only GET /payments/status decides it (rule 1 of the contract).
export type Phase = 'starting' | 'awaiting' | 'confirming' | 'paid' | 'failed' | 'dropped' | 'stuck';
export const FINAL_PHASES: Phase[] = ['paid', 'failed', 'dropped'];

export function phaseFromStatus(s: Pick2<StatusAnswer, 'outcome' | 'payment_status'>): 'paid' | 'confirming' | 'failed' | 'dropped' {
  switch (s.outcome) {
    case 'paid': case 'cod': return 'paid';
    case 'pending': return 'confirming';
    case 'dropped': return 'dropped';
    case 'failed': case 'expired': case 'refunded': return 'failed';
  }
  if (s.payment_status === 'paid') return 'paid';
  if (s.payment_status === 'failed' || s.payment_status === 'refunded' || s.payment_status === 'not_charged') return 'failed';
  return 'confirming';
}
type Pick2<T, K extends keyof T> = { [P in K]: T[P] };

// The customer closed the payment page or app by hand: ask the server once; a payment that is still pending then counts as
// cancelled (back to the method list, cart intact). Paid and failed stay as the server says.
export function afterManualClose(s: Pick2<StatusAnswer, 'outcome' | 'payment_status'>): 'paid' | 'failed' | 'dropped' {
  const p = phaseFromStatus(s);
  return p === 'confirming' ? 'dropped' : p;
}

// A UPI app / QR / collect request is waiting for the customer. The server's "pending" is the normal answer then.
// After they come back (app returns to the front, page closes) the same "pending" means the bank is confirming.
export function phaseAfterPoll(current: Phase, s: Pick2<StatusAnswer, 'outcome' | 'payment_status'>): Phase {
  const p = phaseFromStatus(s);
  if (p !== 'confirming') return p;
  return current === 'awaiting' ? 'awaiting' : 'confirming';
}

// The words for a failure. The server's own sentence (English) is shown only in English; otherwise the catalogue line for the outcome.
export type FailureKey = 'payui.failed.generic' | 'payui.failed.expired' | 'payui.failed.refunded';
export function failureKey(outcome: string): FailureKey {
  return outcome === 'expired' ? 'payui.failed.expired' : outcome === 'refunded' ? 'payui.failed.refunded' : 'payui.failed.generic';
}
export function failureText(s: { outcome: string; message: string | null }, english: boolean): { text: string } | { key: FailureKey } {
  return english && s.message ? { text: s.message } : { key: failureKey(s.outcome) };
}

// Server error codes on POST /payments/order and /payments/upi mapped to what the screen does next.
export type ErrorAction = 'show' | 'confirm_pending' | 'ask_phone' | 'refresh_cart' | 'use_hosted' | 'restart' | 'use_cash';
export function errorAction(code: string | undefined): ErrorAction {
  switch (code) {
    case 'payment_in_progress': return 'confirm_pending';
    case 'phone_required': return 'ask_phone';
    case 'price_changed': return 'refresh_cart';
    case 'upi_direct_unavailable': return 'use_hosted';
    case 'session_expired': return 'restart';
    case 'switched_to_cash': return 'use_cash';
    default: return 'show';
  }
}

// ── Polling ────────────────────────────────────────────────────────────────────────────────────────────
export const DEFAULT_POLL_MS = 3000;
export const MIN_POLL_MS = 2000; // the server allows a call every 2 seconds
export const MAX_POLL_MS = 10_000;
export const MAX_ERROR_BACKOFF_MS = 15_000;
export const DEFAULT_GIVE_UP_MS = 300_000;

// Wait before the next status call. Follows the server's poll_after_ms (never faster than 2 s); slows down gently after
// 10 calls; after failed calls (no connection) backs off 3 s, 6 s, 12 s, 15 s ...
export function nextPollDelay(o: { attempt: number; pollAfterMs?: number | null; errors?: number }): number {
  if ((o.errors ?? 0) > 0) return Math.min(DEFAULT_POLL_MS * 2 ** ((o.errors ?? 1) - 1), MAX_ERROR_BACKOFF_MS);
  const base = Math.min(Math.max(o.pollAfterMs ?? DEFAULT_POLL_MS, MIN_POLL_MS), MAX_POLL_MS);
  if (o.attempt < 10) return base;
  const slow = Math.round(base * 1.5 ** (Math.floor((o.attempt - 10) / 5) + 1));
  return Math.min(slow, MAX_POLL_MS);
}
// Stop asking after this long: show "still confirming, do not pay again", never "failed".
export const shouldGiveUp = (elapsedMs: number, giveUpAfterMs?: number | null) => elapsedMs >= (giveUpAfterMs ?? DEFAULT_GIVE_UP_MS);

// ── UPI request timer ─────────────────────────────────────────────────────────────────────────────────
export const UPI_WINDOW_S = 300;
export function secondsLeft(expiresAt: string | number | null | undefined, now: number, fallbackStart?: number): number {
  const end = expiresAt != null ? new Date(expiresAt).getTime() : (fallbackStart ?? now) + UPI_WINDOW_S * 1000;
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - now) / 1000));
}
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ── Hosted page messages ──────────────────────────────────────────────────────────────────────────────
export type HostedMessage = { type: 'done' | 'failed' | 'dismiss'; checkout_id?: string; hint?: 'paid' | 'pending' | 'failed' };
// The page's cue is only a cue: whatever it says, the screen then asks the server. Returns null for anything else.
export function parseHostedMessage(data: unknown, checkoutId: string): HostedMessage | null {
  let v: unknown = data;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  if (m.type !== 'done' && m.type !== 'failed' && m.type !== 'dismiss') return null;
  if (m.checkout_id != null && m.checkout_id !== checkoutId) return null;
  return { type: m.type, checkout_id: checkoutId, hint: m.hint === 'paid' || m.hint === 'pending' || m.hint === 'failed' ? m.hint : undefined };
}
// onecity://payment-result?checkout_id=<id>&status=<hint>
export function parsePaymentResultLink(url: string): { checkout_id: string; status?: string } | null {
  const m = /^onecity:\/\/payment-result\/?\?(.*)$/i.exec(url);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const id = q.get('checkout_id');
  return id ? { checkout_id: id, status: q.get('status') ?? undefined } : null;
}

// ── Refund line ────────────────────────────────────────────────────────────────────────────────────────
export type RefundRow = { id: string; order_id: string; amount: number; state: 'initiated' | 'processed' | 'failed'; method: 'original' | 'credit' | 'manual' | 'cash'; created_at: string; processed_at: string | null; eta_text?: string | null };
export type RefundKey =
  | 'payui.refund.initiated' | 'payui.refund.initiatedCredit' | 'payui.refund.initiatedManual'
  | 'payui.refund.processed' | 'payui.refund.processedCredit' | 'payui.refund.processedManual' | 'payui.refund.failed';
export function refundKey(r: Pick2<RefundRow, 'state' | 'method'>): RefundKey {
  if (r.state === 'failed') return 'payui.refund.failed';
  const suffix = r.method === 'credit' ? 'Credit' : r.method === 'manual' || r.method === 'cash' ? 'Manual' : '';
  return `payui.refund.${r.state}${suffix}` as RefundKey;
}
// Rows shown on the order screen: newest first. A refund of a cash order never shows a gateway line, only credit/manual ones.
export function refundRows(rows: RefundRow[] | undefined | null): RefundRow[] {
  return [...(rows ?? [])].filter(r => r.amount > 0).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}
export const refundNeedsPolling = (rows: RefundRow[]) => rows.some(r => r.state === 'initiated');
