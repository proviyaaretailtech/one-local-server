// Checks the customer payment screen rules (src/payments/logic.ts) and its wording, with no app, no network and no database.
// Run from frontend/:  npx tsx scripts/payment-ui-checks.ts
import { readFileSync } from 'node:fs';
import {
  afterManualClose, defaultRow, defaultUpi, errorAction, failureKey, failureText, mmss, nextPollDelay, normalizePhone, orderMethods, orderPick,
  parseHostedMessage, parseLastUsed, parsePaymentResultLink, payEnabled, phaseAfterPoll, phaseFromStatus, refundKey, refundNeedsPolling, refundRows,
  secondsLeft, shouldGiveUp, toLastUsed, upiOptions, validVpa, type MethodsResponse, type Outcome, type RefundRow,
} from '../src/payments/logic';

let passed = 0;
function check(what: string, ok: boolean, detail?: unknown) {
  if (!ok) { console.error(`FAIL  ${what}`, detail ?? ''); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
}
const eq = (what: string, got: unknown, want: unknown) => check(what, JSON.stringify(got) === JSON.stringify(want), { got, want });

const ALL: MethodsResponse = {
  provider: 'cashfree', online: true, environment: 'sandbox',
  cod: { available: true, reason: null, max_total: null, note: 'Pay cash' },
  upi: { available: true, hosted: true, apps: ['google_pay', 'phonepe', 'paytm', 'bhim'], intent: true, qr: true, collect: true, collect_note: 'May not work on Android phones' },
  card: { available: true, hosted: true }, netbanking: { available: true, hosted: true }, wallet: { available: true, hosted: true },
};
const ids = (m: MethodsResponse | null, last: Parameters<typeof orderMethods>[1] = null) => orderMethods(m, last).map(r => r.id);

// ── method ordering ────────────────────────────────────────────────────────────────────────────
eq('standard order is UPI, cards, netbanking and wallets, cash', ids(ALL), ['upi', 'card', 'netbanking', 'cod']);
eq('last-used card goes on top', ids(ALL, { method: 'card' }), ['card', 'upi', 'netbanking', 'cod']);
eq('last-used cash goes on top', ids(ALL, { method: 'cod' }), ['cod', 'upi', 'card', 'netbanking']);
check('only the top row is marked last used', orderMethods(ALL, { method: 'card' }).filter(r => r.lastUsed).map(r => r.id).join() === 'card');
check('last used UPI stays on top, marked', orderMethods(ALL, { method: 'upi' })[0].lastUsed);
eq('no history: nothing marked', orderMethods(ALL, null).filter(r => r.lastUsed).length, 0);
eq('a last-used method that is now off is ignored', ids({ ...ALL, card: { available: false } }, { method: 'card' }), ['upi', 'netbanking', 'cod']);
eq('wallets alone keep the netbanking-and-wallets row', ids({ ...ALL, netbanking: { available: false } }), ['upi', 'card', 'netbanking', 'cod']);
eq('neither netbanking nor wallets: row hidden', ids({ ...ALL, netbanking: { available: false }, wallet: { available: false } }), ['upi', 'card', 'cod']);
const noProvider: MethodsResponse = { ...ALL, provider: null, online: false, upi: { ...ALL.upi, available: false }, card: { available: false }, netbanking: { available: false }, wallet: { available: false } };
eq('no provider: cash only', ids(noProvider), ['cod']);
const over = orderMethods({ ...ALL, cod: { available: false, reason: 'over_limit', max_total: 5000 } }, { method: 'cod' });
check('cash over the limit is listed, unavailable, with its reason', over.at(-1)?.id === 'cod' && !over.at(-1)!.available && over.at(-1)!.reason === 'over_limit', over);
check('unavailable last-used cash does not jump to the top', over[0].id === 'upi' && !over[0].lastUsed);
eq('cash switched off says disabled', orderMethods({ ...ALL, cod: { available: false, reason: null, max_total: null } }, null).at(-1)?.reason, 'disabled');
eq('default selection is the top usable row', defaultRow(orderMethods(ALL, { method: 'card' })), 'card');
eq('default skips unusable rows', defaultRow(orderMethods({ ...noProvider, cod: { available: false, reason: 'disabled', max_total: null } }, null)), null);
eq('empty answer, empty list', ids(null), []);

// ── UPI choices ────────────────────────────────────────────────────────────────────────────────
eq('phone: app tiles, no QR', upiOptions(ALL, 'native'), { apps: ['google_pay', 'phonepe', 'paytm', 'bhim'], qr: false, hosted: true, collect: true });
eq('web: QR, no app tiles', upiOptions(ALL, 'web'), { apps: [], qr: true, hosted: true, collect: true });
eq('phone default: first app', defaultUpi(ALL, 'native'), { mode: 'intent', app: 'google_pay' });
eq('phone default: remembered app', defaultUpi(ALL, 'native', { method: 'upi', mode: 'intent', app: 'paytm' }), { mode: 'intent', app: 'paytm' });
eq('web default: QR', defaultUpi(ALL, 'web'), { mode: 'qr' });
eq('no intent, no QR: hosted page', defaultUpi({ ...ALL, upi: { ...ALL.upi, intent: false, qr: false } }, 'native'), { mode: 'hosted' });
eq('a remembered app that is no longer offered falls back', defaultUpi({ ...ALL, upi: { ...ALL.upi, apps: ['phonepe'] } }, 'native', { method: 'upi', mode: 'intent', app: 'paytm' }), { mode: 'intent', app: 'phonepe' });
eq('typed UPI ID is never remembered', toLastUsed({ method: 'upi', mode: 'collect', vpa: 'me@okbank' }), { method: 'upi', mode: 'hosted' });
eq('an app choice is remembered', toLastUsed({ method: 'upi', mode: 'intent', app: 'phonepe' }), { method: 'upi', mode: 'intent', app: 'phonepe' });
eq('card choice is remembered as card only', toLastUsed({ method: 'card', phone: '9876543210' }), { method: 'card' });
eq('stored preference round-trips', parseLastUsed(JSON.stringify(toLastUsed({ method: 'upi', mode: 'qr' }))), { method: 'upi', mode: 'qr', app: undefined });
eq('garbage preference is ignored', parseLastUsed('{"method":"bitcoin"}'), null);
eq('broken preference is ignored', parseLastUsed('nope'), null);
check('UPI id: valid', validVpa('name.surname@okhdfcbank') && validVpa('9876543210@ybl'));
check('UPI id: invalid', !validVpa('') && !validVpa('name') && !validVpa('@ybl') && !validVpa('a b@ybl') && !validVpa('name@'));
eq('phone: plain', normalizePhone('9876543210'), '9876543210');
eq('phone: +91 with spaces', normalizePhone('+91 98765 43210'), '9876543210');
eq('phone: leading zero', normalizePhone('09876543210'), '9876543210');
eq('phone: too short', normalizePhone('98765'), '');
eq('phone: not an Indian mobile', normalizePhone('1234567890'), '');
eq('order body for an app', orderPick({ method: 'upi', mode: 'intent', app: 'bhim' }), { payment_method: 'upi', upi_app: 'bhim' });
eq('order body for QR has no app', orderPick({ method: 'upi', mode: 'qr' }), { payment_method: 'upi', upi_app: null });
eq('order body for netbanking and wallets', orderPick({ method: 'netbanking' }), { payment_method: 'netbanking', upi_app: null });
check('cash is not an online order', (() => { try { orderPick({ method: 'cod' }); return false; } catch { return true; } })());

// ── Pay button ─────────────────────────────────────────────────────────────────────────────────
const row = (id: 'upi' | 'card' | 'netbanking' | 'cod', available = true) => ({ id, available, reason: null, lastUsed: false } as const);
check('pay enabled for a card with a phone', payEnabled({ row: row('card'), busy: false, phoneOk: true }));
check('double tap guard: busy disables pay', !payEnabled({ row: row('card'), busy: true, phoneOk: true }));
check('no mobile number: online pay disabled', !payEnabled({ row: row('card'), busy: false, phoneOk: false }));
check('no mobile number: cash still works', payEnabled({ row: row('cod'), busy: false, phoneOk: false }));
check('unavailable method cannot be paid', !payEnabled({ row: row('cod', false), busy: false, phoneOk: true }));
check('typed UPI ID must be valid', !payEnabled({ row: row('upi'), busy: false, mode: 'collect', vpa: 'bad', phoneOk: true }) && payEnabled({ row: row('upi'), busy: false, mode: 'collect', vpa: 'me@ybl', phoneOk: true }));
check('UPI app needs an app', !payEnabled({ row: row('upi'), busy: false, mode: 'intent', phoneOk: true }) && payEnabled({ row: row('upi'), busy: false, mode: 'intent', app: 'paytm', phoneOk: true }));
check('nothing selected: disabled', !payEnabled({ row: undefined, busy: false, phoneOk: true }));

// ── Outcome state machine ──────────────────────────────────────────────────────────────────────
const st = (outcome: Outcome, payment_status = 'pending') => ({ outcome, payment_status });
eq('paid -> success', phaseFromStatus(st('paid', 'paid')), 'paid');
eq('cash switch -> order placed', phaseFromStatus(st('cod', 'not_charged')), 'paid');
eq('pending -> confirming', phaseFromStatus(st('pending')), 'confirming');
eq('failed -> failed', phaseFromStatus(st('failed', 'failed')), 'failed');
eq('expired -> failed', phaseFromStatus(st('expired', 'failed')), 'failed');
eq('refunded is not a success', phaseFromStatus(st('refunded', 'refunded')), 'failed');
eq('dropped -> dropped', phaseFromStatus(st('dropped', 'failed')), 'dropped');
eq('unknown outcome falls back to the payment status', phaseFromStatus({ outcome: 'weird' as Outcome, payment_status: 'paid' }), 'paid');
eq('unknown outcome and status: keep confirming (never failed by guess)', phaseFromStatus({ outcome: 'weird' as Outcome, payment_status: 'pending' }), 'confirming');
eq('waiting for the customer stays waiting on pending', phaseAfterPoll('awaiting', st('pending')), 'awaiting');
eq('confirming stays confirming on pending', phaseAfterPoll('confirming', st('pending')), 'confirming');
eq('waiting + paid -> paid', phaseAfterPoll('awaiting', st('paid', 'paid')), 'paid');
eq('waiting + failed -> failed', phaseAfterPoll('awaiting', st('failed', 'failed')), 'failed');
eq('closed by hand while pending counts as cancelled', afterManualClose(st('pending')), 'dropped');
eq('closed by hand but it was paid: paid', afterManualClose(st('paid', 'paid')), 'paid');
eq('closed by hand but it failed: failed', afterManualClose(st('failed', 'failed')), 'failed');
for (const e of ['payment_in_progress', 'phone_required', 'price_changed', 'upi_direct_unavailable', 'session_expired', 'switched_to_cash', 'gateway_unavailable', undefined])
  check(`error action for ${e}`, typeof errorAction(e) === 'string');
eq('in progress -> keep confirming, never a new attempt', errorAction('payment_in_progress'), 'confirm_pending');
eq('direct UPI refused -> hosted page', errorAction('upi_direct_unavailable'), 'use_hosted');
eq('gateway down -> just show it', errorAction('gateway_unavailable'), 'show');

// ── Polling ────────────────────────────────────────────────────────────────────────────────────
eq('first poll follows the server', nextPollDelay({ attempt: 0, pollAfterMs: 3000 }), 3000);
eq('never faster than 2 seconds', nextPollDelay({ attempt: 0, pollAfterMs: 500 }), 2000);
eq('default 3 seconds when the server says nothing', nextPollDelay({ attempt: 2 }), 3000);
eq('slows after 10 calls', nextPollDelay({ attempt: 10, pollAfterMs: 3000 }), 4500);
eq('slows more after 15 calls', nextPollDelay({ attempt: 15, pollAfterMs: 3000 }), 6750);
eq('capped at 10 seconds', nextPollDelay({ attempt: 60, pollAfterMs: 3000 }), 10000);
eq('no connection backs off 3 s, 6 s, 12 s', [1, 2, 3].map(errors => nextPollDelay({ attempt: 5, errors })), [3000, 6000, 12000]);
eq('no connection capped at 15 seconds', nextPollDelay({ attempt: 5, errors: 9 }), 15000);
check('keeps polling before the give-up time', !shouldGiveUp(299_999, 300_000));
check('stops at the give-up time', shouldGiveUp(300_000, 300_000));
check('default give-up is five minutes', shouldGiveUp(300_000) && !shouldGiveUp(10_000));
{ // the whole schedule over the give-up window stays well inside what the server allows
  let t = 0, n = 0, attempt = 0; while (t < 300_000 && n < 500) { t += nextPollDelay({ attempt: attempt++, pollAfterMs: 3000 }); n++; }
  check(`about ${n} status calls in five minutes (at most one per 2 s)`, n <= 300_000 / 2000 && n >= 30, n);
}

// ── UPI timer ──────────────────────────────────────────────────────────────────────────────────
const t0 = Date.parse('2026-10-08T10:00:00Z');
eq('timer from the server expiry', secondsLeft('2026-10-08T10:05:00Z', t0), 300);
eq('timer counts down', secondsLeft('2026-10-08T10:05:00Z', t0 + 61_000), 239);
eq('timer never negative', secondsLeft('2026-10-08T10:05:00Z', t0 + 999_000), 0);
eq('timer without expiry: five minutes from opening', secondsLeft(undefined, t0 + 60_000, t0), 240);
eq('mm:ss', [mmss(300), mmss(65), mmss(9), mmss(0)], ['5:00', '1:05', '0:09', '0:00']);

// ── Payment page messages ─────────────────────────────────────────────────────────────────────
eq('page cue (string) is read', parseHostedMessage('{"type":"done","checkout_id":"c1","hint":"paid"}', 'c1'), { type: 'done', checkout_id: 'c1', hint: 'paid' });
eq('page cue (object) is read', parseHostedMessage({ type: 'failed', checkout_id: 'c1', hint: 'failed' }, 'c1')?.type, 'failed');
eq('dismiss is read', parseHostedMessage({ type: 'dismiss', checkout_id: 'c1' }, 'c1')?.type, 'dismiss');
eq('another checkout is ignored', parseHostedMessage({ type: 'done', checkout_id: 'other' }, 'c1'), null);
eq('unknown cue is ignored', parseHostedMessage({ type: 'refund' }, 'c1'), null);
eq('junk is ignored', [parseHostedMessage('not json', 'c1'), parseHostedMessage(null, 'c1'), parseHostedMessage(42, 'c1')], [null, null, null]);
eq('result link is read', parsePaymentResultLink('onecity://payment-result?checkout_id=abc&status=paid'), { checkout_id: 'abc', status: 'paid' });
eq('result link needs a checkout', parsePaymentResultLink('onecity://payment-result?status=paid'), null);
eq('other links are not result links', parsePaymentResultLink('upi://pay?pa=x@y'), null);

// ── Refund line ───────────────────────────────────────────────────────────────────────────────
const refund = (over: Partial<RefundRow>): RefundRow => ({ id: 'r', order_id: 'o', amount: 250, state: 'initiated', method: 'original', created_at: '2026-10-08T10:00:00Z', processed_at: null, ...over });
eq('refund initiated wording key', refundKey(refund({})), 'payui.refund.initiated');
eq('refund processed wording key', refundKey(refund({ state: 'processed' })), 'payui.refund.processed');
eq('refund failed wording key (support link)', refundKey(refund({ state: 'failed' })), 'payui.refund.failed');
eq('store credit wording', refundKey(refund({ method: 'credit' })), 'payui.refund.initiatedCredit');
eq('manual payout wording', refundKey(refund({ state: 'processed', method: 'manual' })), 'payui.refund.processedManual');
eq('cash order refunds read as a manual payout', refundKey(refund({ method: 'cash' })), 'payui.refund.initiatedManual');
eq('refund rows newest first, empty amounts hidden', refundRows([refund({ id: 'a' }), refund({ id: 'b', created_at: '2026-10-09T10:00:00Z' }), refund({ id: 'c', amount: 0 })]).map(r => r.id), ['b', 'a']);
check('keeps polling while a refund is initiated', refundNeedsPolling([refund({})]) && !refundNeedsPolling([refund({ state: 'processed' }), refund({ state: 'failed' })]));
eq('no refunds, no line', refundRows(undefined), []);

// ── Wording ──────────────────────────────────────────────────────────────────────────────────
eq('English shows the server sentence', failureText({ outcome: 'failed', message: 'Your bank declined the payment.' }, true), { text: 'Your bank declined the payment.' });
eq('Hindi shows the catalogue line, not English', failureText({ outcome: 'failed', message: 'Your bank declined the payment.' }, false), { key: 'payui.failed.generic' });
eq('no server sentence: catalogue line', failureText({ outcome: 'expired', message: null }, true), { key: 'payui.failed.expired' });
eq('refunded reads as returned', failureKey('refunded'), 'payui.failed.refunded');

// Every sentence the payment screens use exists in English and Hindi, with the same {{placeholders}}; the pending warning says "do not pay again".
const en = JSON.parse(readFileSync(new URL('../src/i18n/locales/en.json', import.meta.url), 'utf8'));
const hi = JSON.parse(readFileSync(new URL('../src/i18n/locales/hi.json', import.meta.url), 'utf8'));
const dig = (o: any, path: string) => path.split('.').reduce((a, k) => a?.[k], o);
const holes = (s: string) => [...s.matchAll(/\{\{\s*([^},\s]+)/g)].map(m => m[1]).sort().join();
const used = ['payui.test', 'payui.loading', 'payui.loadError', 'payui.lastUsed', 'payui.online', 'payui.cashNote', 'payui.upi.title', 'payui.upi.pickApp', 'payui.upi.qr', 'payui.upi.other', 'payui.upi.more', 'payui.upi.useId',
  'payui.upi.idInvalid', 'payui.upi.idNote', 'payui.upi.appA11y', 'payui.card.sub', 'payui.net.title', 'payui.cod.sub', 'payui.cod.over', 'payui.cod.off', 'payui.phone.invalid', 'payui.open.web', 'payui.open.blocked',
  'payui.wait.title', 'payui.wait.body', 'payui.wait.timer', 'payui.wait.timerEnded', 'payui.qr.title', 'payui.qr.body', 'payui.qr.a11y', 'payui.collect.title', 'payui.collect.body', 'payui.confirm.title', 'payui.confirm.body',
  'payui.confirm.offline', 'payui.stuck.title', 'payui.stuck.body', 'payui.paid.title', 'payui.failed.title', 'payui.failed.body', 'payui.failed.generic', 'payui.failed.expired', 'payui.failed.refunded', 'payui.failed.other',
  'payui.failed.again', 'payui.failed.cash', 'payui.dropped.title', 'payui.dropped.body', 'payui.dropped.choose', 'payui.pending.title', 'payui.refund.eta', 'payui.refund.support',
  'payui.refund.initiated', 'payui.refund.initiatedCredit', 'payui.refund.initiatedManual', 'payui.refund.processed', 'payui.refund.processedCredit', 'payui.refund.processedManual', 'payui.refund.failed',
  'errors.code.phone_required', 'errors.code.price_changed', 'errors.code.payment_in_progress', 'errors.code.gateway_unavailable', 'errors.code.upi_id_invalid', 'errors.code.session_expired'];
check('every payment sentence exists in English and Hindi with the same placeholders', used.every(k => {
  const a = dig(en, k), b = dig(hi, k);
  const ok = typeof a === 'string' && typeof b === 'string' && a.trim() && b.trim() && holes(a) === holes(b);
  if (!ok) console.error('  missing or mismatched:', k);
  return ok;
}));
check('the pending sentence says do not pay again, in both languages', /do not pay again/i.test(dig(en, 'payui.confirm.body')) && /दोबारा भुगतान न करें/.test(dig(hi, 'payui.confirm.body')));
check('the failure sentence says the cart is safe, in both languages', /cart is safe/i.test(dig(en, 'payui.failed.body')) && /कार्ट सुरक्षित/.test(dig(hi, 'payui.failed.body')));
check('the refund sentence names the amount, the original method and 3-5 working days', /\{\{amount\}\}/.test(dig(en, 'payui.refund.initiated')) && /original payment method/.test(dig(en, 'payui.refund.initiated')) && /3-5 working days/.test(dig(en, 'payui.refund.eta')));
check('no payment sentence contains a secret-looking value', JSON.stringify(dig(en, 'payui')).search(/secret|session_|sk_|key=/i) === -1);

console.log(`\n${passed} checks passed${process.exitCode ? ', SOME FAILED' : ''}`);
