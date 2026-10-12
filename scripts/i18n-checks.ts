// Checks the customer app's i18n framework with no phone, no network and no React Native: the language
// switcher's state machine (idle -> loading -> ready | error, 8 s timeout, last choice wins, atomic swap, saved
// language first), catalogue parity and placeholders, English fallback (missing / empty Hindi never shows blank),
// the ₹ / distance / minutes / date formats (Indian grouping, Latin digits, India time), the code -> label
// mappings (order status, payment status, payment method, API errors) and the dev pseudo-locale.
// Run from frontend/:  npx tsx scripts/i18n-checks.ts      (npm run i18n:test)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyLocale, createI18n } from '../src/i18n/core';
import { ERROR_CODES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, errorKey, errorMessage, orderStatusKey, paymentMethodKey, paymentStatusKey } from '../src/i18n/codes';
import { formatRelativeDay, groupIndian, makeFormatter, localizeDigits } from '../src/i18n/format';
import { createLocaleController, LOAD_TIMEOUT_MS, type LocaleDeps, type LocaleState, type SavedLanguage } from '../src/i18n/loader';
import { LOCALES, SUPPORTED, localeMeta } from '../src/i18n/locales';
import { pseudoLocalize, pseudoString } from '../src/i18n/pseudo';
import { languageOfTag, parseStored, resolveStartLocale } from '../src/i18n/resolve';
import { MIN_LINE_HEIGHT_RATIO, WEB_FONT_STACK, safeLineHeight } from '../src/i18n/typography';

let passed = 0;
function check(what: string, ok: boolean, detail?: unknown) {
  if (!ok) { console.error('FAIL ', what, detail === undefined ? '' : JSON.stringify(detail)); process.exitCode = 1; }
  else { passed++; console.log('ok   ', what); }
}
const flatten = (o: Record<string, unknown>, p = '', out: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries(o)) { const key = p ? `${p}.${k}` : k; if (v && typeof v === 'object') flatten(v as Record<string, unknown>, key, out); else out[key] = String(v); }
  return out;
};
const tokens = (s: string) => [...s.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)].map(m => m[1]).sort().join(',');
const read = (name: string) => JSON.parse(readFileSync(join(__dirname, '..', 'src', 'i18n', 'locales', `${name}.json`), 'utf8')) as Record<string, unknown>;
const defer = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise<void>(r => setTimeout(r, 0));

async function main() {
  // ---------- Catalogues ----------
  const en = flatten(read('en')); const hi = flatten(read('hi'));
  check('English and Hindi have exactly the same keys', JSON.stringify(Object.keys(en).sort()) === JSON.stringify(Object.keys(hi).sort()), {
    onlyEn: Object.keys(en).filter(k => !(k in hi)).slice(0, 10), onlyHi: Object.keys(hi).filter(k => !(k in en)).slice(0, 10),
  });
  check('no empty value in either catalogue', Object.entries({ ...en }).every(([, v]) => v.trim()) && Object.values(hi).every(v => v.trim()));
  check('every Hindi value keeps the English {{placeholders}}', Object.keys(en).every(k => tokens(en[k]!) === tokens(hi[k] ?? '')), Object.keys(en).filter(k => tokens(en[k]!) !== tokens(hi[k] ?? '')).slice(0, 10));
  check('Hindi uses Latin digits (no Devanagari digits)', Object.values(hi).every(v => !/[०-९]/.test(v)));
  check('plural keys come in pairs (_one + _other) in both languages', [en, hi].every(cat => Object.keys(cat).filter(k => k.endsWith('_one')).every(k => `${k.slice(0, -4)}_other` in cat)));
  check('Hindi is really Hindi: most values contain Devanagari', Object.values(hi).filter(v => /[ऀ-ॿ]/.test(v)).length / Object.keys(hi).length > 0.85);

  // ---------- Registry ----------
  check('the registry offers English and Hindi, and no pseudo-locale in a production-like run', SUPPORTED.includes('en') && SUPPORTED.includes('hi') && !SUPPORTED.includes('en-XA'), SUPPORTED);
  check('each language has its own name, a sample line and a Latin-digit Intl tag', LOCALES.every(l => l.nativeName && l.sample && l.chooser) && localeMeta('hi').intl.includes('-u-nu-latn') && localeMeta('hi').nativeName === 'हिन्दी');
  check('English is the first (default) language', LOCALES[0]!.code === 'en');

  // ---------- Which language to start in (saved first) ----------
  const supported = ['en', 'hi'];
  check('a saved language wins over the phone language', resolveStartLocale({ stored: { locale: 'hi', confirmed: true }, deviceTags: ['en-IN'], supported }).locale === 'hi');
  check('a saved language reports it was chosen (no first-run screen)', resolveStartLocale({ stored: { locale: 'hi', confirmed: true }, deviceTags: [], supported }).confirmed === true);
  check('a saved but unconfirmed choice still starts in it and asks again', (() => { const r = resolveStartLocale({ stored: { locale: 'hi', confirmed: false }, deviceTags: ['en-US'], supported }); return r.locale === 'hi' && !r.confirmed && r.source === 'stored'; })());
  check('no saved language: the first phone language we have wins (hi-IN -> hi)', (() => { const r = resolveStartLocale({ stored: null, deviceTags: ['hi-IN', 'en-US'], supported }); return r.locale === 'hi' && r.source === 'device' && !r.confirmed; })());
  check('unsupported phone languages are skipped (mr-IN, then en)', resolveStartLocale({ stored: null, deviceTags: ['mr-IN', 'en-GB'], supported }).locale === 'en');
  check('nothing usable falls back to English', resolveStartLocale({ stored: null, deviceTags: [], supported }).locale === 'en' && resolveStartLocale({ stored: null, deviceTags: ['xx'], supported }).source === 'fallback');
  check('a saved language this build no longer ships is ignored', resolveStartLocale({ stored: { locale: 'mr', confirmed: true }, deviceTags: ['hi'], supported }).locale === 'hi');
  check('tags are matched on the language part (hi_IN, hi-Latn-IN, HI)', ['hi_IN', 'hi-Latn-IN', 'HI'].every(t => languageOfTag(t) === 'hi'));
  check('saved value parsing is defensive', parseStored(null) === null && parseStored('nope') === null && parseStored('{"locale":5}') === null && parseStored('{"locale":"hi"}')?.confirmed === false && parseStored('{"locale":"hi","confirmed":true}')?.confirmed === true);

  // ---------- The language switcher (state machine) ----------
  type Harness = ReturnType<typeof harness>;
  function harness(overrides: Partial<LocaleDeps> = {}, start = { active: 'en', confirmed: true }) {
    const catalogues: Record<string, ReturnType<typeof defer<Record<string, unknown>>>> = {};
    const fonts: Record<string, ReturnType<typeof defer<void>>> = {};
    const log: string[] = []; const saved: SavedLanguage[] = []; const loads: string[] = [];
    const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
    const deps: LocaleDeps = {
      supported: ['en', 'hi', 'xx'], initial: start,
      loadCatalogue: code => { loads.push(code); return (catalogues[code] = defer()).promise; },
      loadFonts: code => (fonts[code] = defer<void>()).promise,
      apply: code => { log.push(`apply:${code}`); },
      persist: async v => { saved.push(v); },
      timers: { set: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length - 1; }, clear: h => { const t = timers[h as number]; if (t) t.cleared = true; } },
      ...overrides,
    };
    const c = createLocaleController(deps);
    const states: LocaleState[] = []; c.subscribe(() => states.push(c.getState()));
    const done = (code: string) => { catalogues[code]!.resolve({ marker: code }); fonts[code]?.resolve(); };
    return { c, catalogues, fonts, log, saved, loads, timers, states, done };
  }
  const statuses = (h: Harness) => h.states.map(s => s.status).join('>');

  {
    const h = harness();
    check('starts idle in the language the app started in', h.c.getState().status === 'idle' && h.c.getState().active === 'en' && h.c.getState().target === null);
    const p = h.c.select('hi'); await tick();
    check('selecting a language starts loading and the CURRENT language stays on screen', h.c.getState().status === 'loading' && h.c.getState().target === 'hi' && h.c.getState().active === 'en' && h.log.length === 0);
    h.catalogues.hi!.resolve({ a: 1 }); await tick();
    check('nothing is swapped while the font is still loading (no half-translated flash)', h.log.length === 0 && h.c.getState().active === 'en');
    h.fonts.hi!.resolve(); await p;
    check('once catalogue and font are ready there is ONE swap', h.log.join() === 'apply:hi' && h.c.getState().active === 'hi' && h.c.getState().status === 'ready' && h.c.getState().target === null);
    check('the state moved idle -> loading -> ready', statuses(h) === 'loading>ready', statuses(h));
    check('the choice is saved with the new language', h.saved.at(-1)?.locale === 'hi' && h.saved.at(-1)?.confirmed === true, h.saved);
    check('a swap is counted once (for the screen-reader announcement)', h.c.getState().swaps === 1);
    check('the 8 second timer was armed and then cleared', h.timers.length === 1 && h.timers[0]!.ms === LOAD_TIMEOUT_MS && LOAD_TIMEOUT_MS === 8000 && h.timers[0]!.cleared);
  }
  {
    const h = harness();
    const p = h.c.select('hi'); await tick();
    h.catalogues.hi!.reject(new Error('network')); h.fonts.hi!.resolve(); await p;
    check('a failed load leaves the app in its current language with an error', h.c.getState().status === 'error' && h.c.getState().error === 'load' && h.c.getState().active === 'en' && h.c.getState().target === 'hi' && h.log.length === 0);
    check('nothing is saved when a load failed', h.saved.length === 0);
    const r = h.c.retry(); await tick();
    check('Retry loads again from scratch (the failure is not cached)', h.loads.length === 2 && h.c.getState().status === 'loading');
    h.done('hi'); await r;
    check('Retry succeeds: error -> loading -> ready', statuses(h) === 'loading>error>loading>ready', statuses(h));
    check('retry with nothing failed does nothing', await h.c.retry() === undefined && h.loads.length === 2);
  }
  {
    const h = harness();
    const p = h.c.select('hi'); await tick();
    h.timers[0]!.fn(); await p;
    check('after 8 seconds the load gives up: error "timeout", still in the current language', h.c.getState().status === 'error' && h.c.getState().error === 'timeout' && h.c.getState().active === 'en' && h.log.length === 0);
    h.done('hi'); await tick();
    check('a result that arrives after the timeout is ignored', h.log.length === 0 && h.c.getState().active === 'en' && h.c.getState().status === 'error');
    const r = h.c.retry(); await tick();
    check('after a timeout, Retry starts a NEW load (does not wait on the hung one)', h.loads.length === 2);
    h.done('hi'); await r;
    check('and then switches', h.c.getState().active === 'hi' && h.c.getState().status === 'ready');
  }
  {
    const h = harness();
    const a = h.c.select('hi'); await tick();
    const b = h.c.select('xx'); await tick();
    h.done('xx'); await b;
    check('last selection wins: the newer language is applied', h.c.getState().active === 'xx' && h.log.join() === 'apply:xx');
    h.done('hi'); await a;
    check('and the older, slower language never overwrites it', h.c.getState().active === 'xx' && h.log.join() === 'apply:xx' && h.saved.at(-1)?.locale === 'xx' && h.c.getState().status === 'ready');
  }
  {
    const h = harness();
    const a = h.c.select('hi'); await tick();
    await h.c.select('en'); // back to what is showing while Hindi still loads
    check('choosing the language already showing cancels the pending load without any visible change', h.c.getState().status === 'ready' && h.c.getState().active === 'en' && h.c.getState().target === null && h.log.length === 0);
    h.done('hi'); await a;
    check('the cancelled load never swaps', h.log.length === 0 && h.c.getState().active === 'en');
  }
  {
    const h = harness();
    const a = h.c.select('hi'); const b = h.c.select('hi'); const c = h.c.select('hi'); await tick();
    check('double / triple tap loads once', h.loads.length === 1 && h.timers.length === 1);
    h.done('hi'); await Promise.all([a, b, c]);
    check('and swaps once', h.log.join() === 'apply:hi' && h.c.getState().swaps === 1);
    await h.c.select('hi');
    check('tapping the active language is a no-op', h.loads.length === 1 && h.log.length === 1);
    await h.c.select('klingon');
    check('an unknown language code is ignored', h.c.getState().active === 'hi' && h.loads.length === 1);
  }
  {
    const h = harness();
    const a = h.c.select('hi'); await tick(); h.done('hi'); await a;
    const b = h.c.select('en'); await tick(); h.done('en'); await b;
    const c = h.c.select('hi'); await tick(); h.fonts.hi!.resolve(); await c;
    check('a language loaded once is reused: switching back to it needs no second import', h.loads.filter(x => x === 'hi').length === 1 && h.c.getState().active === 'hi', h.loads);
  }
  {
    const h = harness();
    const pre = h.c.prefetch(['hi']); await tick();
    check('prefetch loads quietly: no state change, no swap', h.c.getState().status === 'idle' && h.states.length === 0 && h.loads.join() === 'hi');
    h.catalogues.hi!.resolve({}); await pre;
    const s = h.c.select('hi'); await tick(); h.fonts.hi!.resolve(); await s;
    check('after a prefetch the switch needs no new load and applies at once', h.loads.length === 1 && h.log.join() === 'apply:hi' && h.c.getState().active === 'hi');
  }
  {
    const h = harness();
    const pre = h.c.prefetch(['hi']); await tick(); h.catalogues.hi!.reject(new Error('offline')); await pre;
    check('a failed prefetch is swallowed and does not poison a later select', h.c.getState().status === 'idle');
    const s = h.c.select('hi'); await tick();
    check('...which simply loads again', h.loads.length === 2);
    h.done('hi'); await s;
  }
  {
    const h = harness({ persist: async () => { throw new Error('disk full'); } });
    const p = h.c.select('hi'); await tick(); h.done('hi'); await p;
    check('a failure to save never undoes the switch', h.c.getState().active === 'hi' && h.c.getState().status === 'ready');
  }
  {
    const applied: string[] = [];
    const h = harness({ apply: async code => { applied.push(code); await new Promise(r => setTimeout(r, 15)); } });
    const a = h.c.select('hi'); await tick(); h.done('hi');
    await new Promise(r => setTimeout(r, 5)); // Hindi is being applied right now…
    const b = h.c.select('xx'); await tick();
    check('a choice made while a swap is in flight keeps loading its own language', h.c.getState().status === 'loading' && h.c.getState().target === 'xx');
    await a;
    check('the swap in flight completes and the screen reports the language it is really in', h.c.getState().active === 'hi' && h.c.getState().target === 'xx');
    h.done('xx'); await b;
    check('then the newer choice lands and wins', h.c.getState().active === 'xx' && h.c.getState().status === 'ready' && h.saved.at(-1)?.locale === 'xx');
  }
  {
    const h = harness({}, { active: 'hi', confirmed: false });
    check('first run starts unconfirmed', h.c.getState().confirmed === false);
    await h.c.confirm();
    check('Continue remembers the language as a deliberate choice', h.c.getState().confirmed === true && h.saved.at(-1)?.locale === 'hi' && h.saved.at(-1)?.confirmed === true);
    const n = h.saved.length; await h.c.confirm();
    check('confirming twice saves once', h.saved.length === n);
  }
  {
    const h = harness({ onError: () => {} });
    const p = h.c.select('hi'); await tick(); h.catalogues.hi!.reject(new Error('x')); await p;
    const q = h.c.select('xx'); await tick(); h.done('xx'); await q;
    check('after an error, choosing another language works and clears the error', h.c.getState().active === 'xx' && h.c.getState().status === 'ready' && h.c.getState().error === null);
  }

  // ---------- Real i18next: loading, fallback, plurals ----------
  const i18n = createI18n();
  check('i18next starts in English with English bundled (no network needed)', i18n.language === 'en' && i18n.t('common.save') === 'Save');
  check('Hindi is NOT loaded until asked for (lazy)', !i18n.hasResourceBundle('hi', 'translation'));
  await applyLocale(i18n, 'hi', await localeMeta('hi').load());
  check('after the dynamic import, switching to Hindi uses the glossary words', i18n.language === 'hi' && i18n.t('common.save') === 'सहेजें' && i18n.t('common.cancel') === 'रद्द करें' && i18n.t('common.retry') === 'दोबारा कोशिश करें');
  check('{{placeholders}} are filled in Hindi', i18n.t('language.changedAnnouncement', { language: 'हिन्दी' }) === 'भाषा बदलकर हिन्दी कर दी गई');
  i18n.addResourceBundle('zz', 'translation', { common: { save: '' }, only: { here: 'x' } }, true, true);
  check('a missing Hindi key falls back to English, not blank and not the key name', (() => { const v = i18n.t('common.cancel', { lng: 'zz' }); return v === 'Cancel'; })());
  check('an EMPTY value in a language falls back to English too', i18n.t('common.save', { lng: 'zz' }) === 'Save');
  check('an unknown key is never shown blank', String(i18n.t('no.such.key' as never)).length > 0);
  check('the same instance can go back to English at once', (await i18n.changeLanguage('en'), i18n.t('common.save') === 'Save'));
  check('English plurals', (await i18n.changeLanguage('en'), i18n.t('format.minutes', { count: 1, value: '1' }) === '1 min' && i18n.t('format.minutes', { count: 5, value: '5' }) === '5 min'));
  check('Hindi plurals (1 hour / 2 hours)', (await i18n.changeLanguage('hi'), i18n.t('format.hours', { count: 1, value: '1' }) === '1 घंटा' && i18n.t('format.hours', { count: 2, value: '2' }) === '2 घंटे'));

  // ---------- Formats ----------
  const F = (lng: string, numerals?: 'latn' | 'deva') => makeFormatter({ lng, t: i18n.getFixedT(lng) as never, numerals });
  const fe = F('en'); const fh = F('hi');
  check('₹ with Indian grouping', fe.money(0) === '₹0' && fe.money(249) === '₹249' && fe.money(1234) === '₹1,234' && fe.money(123456) === '₹1,23,456' && fe.money(1234567) === '₹12,34,567' && fe.money(100000) === '₹1,00,000' && fe.money(12345678) === '₹1,23,45,678');
  check('whole rupees show no decimals, other amounts show two (as the cart always did)', fe.money(99.5) === '₹99.50' && fe.money(1234.5) === '₹1,234.50' && fe.money(10) === '₹10' && fe.money(0.999) === '₹1');
  check('fixed decimals when asked', fe.money(249, { decimals: 2 }) === '₹249.00' && fe.money(249.6, { decimals: 0 }) === '₹250');
  check('negative amounts and bad numbers', fe.money(-50) === '−₹50' && fe.money(NaN) === '—' && fe.money(Infinity) === '—');
  check('paise (the *_minor twin)', fe.moneyMinor(24900) === '₹249' && fe.moneyMinor(9950) === '₹99.50');
  check('Hindi uses ₹ and Latin digits by default, identical grouping', fh.money(123456) === '₹1,23,456' && fh.money(99.5) === '₹99.50' && !/[०-९]/.test(fh.money(987654)));
  check('Devanagari digits are an option, off by default, Hindi only', F('hi', 'deva').money(1234) === '₹१,२३४' && F('en', 'deva').money(1234) === '₹1,234' && localizeDigits('12', 'hi') === '12');
  check('groupIndian edges', groupIndian('7') === '7' && groupIndian('999') === '999' && groupIndian('1000') === '1,000' && groupIndian('99999') === '99,999' && groupIndian('100000') === '1,00,000');
  check('numbers and percent', fe.number(1234567.891, { maxFractionDigits: 1 }) === '12,34,567.9' && fe.number(4.5, { maxFractionDigits: 1, minFractionDigits: 1 }) === '4.5' && fe.percent(12.5) === '12.5%' && fe.percent(15) === '15%');
  check('distance: metres under 1 km, one decimal under 10, whole above', fe.distance(0.35) === '350 m' && fe.distance(1.234) === '1.2 km' && fe.distance(14.6) === '15 km' && fe.distance(0) === '0 m');
  check('distance in Hindi', fh.distance(0.35) === '350 मी' && fh.distance(1.234) === '1.2 किमी' && fh.distance(-1) === '—');
  check('minutes (ETA)', fe.eta(12) === '12 min' && fe.eta(0.2) === '1 min' && fe.eta(60) === '1 hr' && fe.eta(65) === '1 hr 5 min' && fe.eta(120) === '2 hr');
  check('minutes (ETA) in Hindi', fh.eta(12) === '12 मिनट' && fh.eta(60) === '1 घंटा' && fh.eta(120) === '2 घंटे' && fh.eta(65) === '1 घंटे 5 मिनट');
  check('server delivery-time text is shown in the reader\'s language when it has the usual shape', fh.deliveryTime('10 min') === '10 मिनट' && fh.deliveryTime('25-30 mins') === '25–30 मिनट' && fe.deliveryTime('12 min') === '12 min' && fh.deliveryTime('Tomorrow morning') === 'Tomorrow morning' && fh.deliveryTime(undefined) === '' && fh.deliveryTime(45) === '45 मिनट');
  check('ETA range', fe.etaRange(25, 30) === '25–30 min' && fh.etaRange(25, 30) === '25–30 मिनट' && fe.etaRange(20, 20) === '20 min');
  const moment = new Date('2026-10-02T20:00:00Z'); // 1:30 am on 3 October in India
  check('dates are shown in India time whatever the phone zone is', fe.date(moment, 'medium') === '3 Oct 2026' && fe.date(moment, 'short') === '3 Oct' && /^1:30\s?am$/i.test(fe.time(moment)), [fe.date(moment, 'medium'), fe.time(moment)]);
  check('date + time and long dates', /3 Oct 2026.*1:30\s?am/i.test(fe.dateTime(moment)) && fe.date(moment, 'long') === '3 October 2026', [fe.dateTime(moment), fe.date(moment, 'long')]);
  check('Hindi dates: Hindi month names, Latin digits', (() => { const d = fh.date(moment, 'medium'); return /[ऀ-ॿ]/.test(d) && d.includes('3') && d.includes('2026') && !/[०-९]/.test(d); })(), fh.date(moment, 'medium'));
  check('Devanagari digits in dates only when asked', /[०-९]/.test(F('hi', 'deva').date(moment, 'medium')), F('hi', 'deva').date(moment, 'medium'));
  check('short weekday names (booking chips)', fe.date(moment, 'weekdayShort') === 'Sat' && /[\u0900-\u097F]/.test(fh.date(moment, 'weekdayShort')), [fe.date(moment, 'weekdayShort'), fh.date(moment, 'weekdayShort')]);
  check('ISO strings and timestamps work, bad dates show a dash', fe.date('2026-10-02T20:00:00Z') === '3 Oct 2026' && fe.date(moment.getTime()) === '3 Oct 2026' && fe.date('not a date') === '—');
  {
    const now = new Date('2026-10-03T05:00:00Z'); // 10:30 in India on 3 Oct
    const f = async (iso: string, lng = 'en') => formatRelativeDay(iso, { lng, t: i18n.getFixedT(lng) as never }, now);
    check('Today / Yesterday / Tomorrow follow the INDIA calendar day', await f('2026-10-02T19:00:00Z') === 'Today' && await f('2026-10-02T18:00:00Z') === 'Yesterday' && await f('2026-10-03T19:00:00Z') === 'Tomorrow');
    check('...in Hindi', await f('2026-10-02T19:00:00Z', 'hi') === 'आज' && await f('2026-10-02T18:00:00Z', 'hi') === 'बीता कल');
    check('older dates show the date', await f('2026-09-20T10:00:00Z') === '20 Sept 2026' || await f('2026-09-20T10:00:00Z') === '20 Sep 2026', await f('2026-09-20T10:00:00Z'));
  }

  // ---------- Status, payment and error codes ----------
  const hasKey = (cat: Record<string, string>, k: string) => typeof cat[k] === 'string' && cat[k]!.trim().length > 0;
  check('every order status code has a label in English and Hindi', ORDER_STATUSES.every(c => hasKey(en, `status.order.${c}`) && hasKey(hi, `status.order.${c}`)) && ORDER_STATUSES.join() === 'placed,accepted,packed,out,delivered,cancelled');
  check('every payment status code has a label in English and Hindi', PAYMENT_STATUSES.every(c => hasKey(en, `status.payment.${c}`) && hasKey(hi, `status.payment.${c}`)) && PAYMENT_STATUSES.join() === 'not_charged,pending,paid,failed,refunded');
  check('every payment method code has a label in English and Hindi', PAYMENT_METHODS.every(c => hasKey(en, `status.method.${c}`) && hasKey(hi, `status.method.${c}`)) && PAYMENT_METHODS.join() === 'cod,upi,card,netbanking,wallet,paylater,emi');
  check('every API error code has a message in English and Hindi', ERROR_CODES.every(c => hasKey(en, `errors.code.${c}`) && hasKey(hi, `errors.code.${c}`)) && hasKey(en, 'errors.generic') && hasKey(hi, 'errors.generic'));
  check('the "unknown" fallbacks exist', ['status.order.unknown', 'status.payment.unknown', 'status.method.unknown'].every(k => hasKey(en, k) && hasKey(hi, k)));
  check('glossary words are used for the order and payment states (Hindi)', hi['status.order.out'] === 'डिलीवरी के लिए निकला' && hi['status.order.delivered'] === 'डिलीवर हो गया' && hi['status.order.cancelled'] === 'रद्द' && hi['status.payment.paid'] === 'भुगतान हो गया');
  check('codes map to keys', orderStatusKey('out') === 'status.order.out' && paymentStatusKey('refunded') === 'status.payment.refunded' && paymentMethodKey('netbanking') === 'status.method.netbanking');
  check('spelling variants fold into the canonical code', orderStatusKey('confirmed') === 'status.order.accepted' && orderStatusKey('out_for_delivery') === 'status.order.out' && orderStatusKey('Delivered ') === 'status.order.delivered' && paymentMethodKey('cardless_emi') === 'status.method.emi');
  check('unknown, empty or missing codes get a neutral label, never the raw code', orderStatusKey('zzz') === 'status.order.unknown' && orderStatusKey(undefined) === 'status.order.unknown' && paymentStatusKey(null) === 'status.payment.unknown' && paymentMethodKey('crypto') === 'status.method.unknown');
  check('label lookups end-to-end in both languages', (await i18n.changeLanguage('hi'), i18n.t(orderStatusKey('packed')) === 'पैक हो गया') && (await i18n.changeLanguage('en'), i18n.t(orderStatusKey('packed')) === 'Packed'));
  check('API error codes map to keys', errorKey({ code: 'outside_delivery_area' }) === 'errors.code.outside_delivery_area' && errorKey({ code: 'Merchant_Unavailable' }) === 'errors.code.merchant_unavailable');
  check('a code wins over the status', errorKey({ code: 'address_needs_point', status: 500 }) === 'errors.code.address_needs_point');
  check('without a code the HTTP status decides', errorKey({ status: 429 }) === 'errors.code.rate_limited' && errorKey({ status: 401 }) === 'errors.code.unauthorized' && errorKey({ status: 404 }) === 'errors.code.not_found' && errorKey({ status: 503 }) === 'errors.code.server_error');
  check('a failed fetch is "offline"', errorKey(new TypeError('Network request failed')) === 'errors.code.offline' && errorKey(new TypeError('Failed to fetch')) === 'errors.code.offline');
  check('anything else is the generic line', errorKey(new Error('boom')) === 'errors.generic' && errorKey(null) === 'errors.generic' && errorKey('x') === 'errors.generic');
  {
    const tEn = i18n.getFixedT('en') as never; const tHi = i18n.getFixedT('hi') as never;
    check('a coded error is translated', errorMessage(tHi, { code: 'out_of_zone' }, 'hi') === hi['errors.code.out_of_zone'] && errorMessage(tEn, { code: 'out_of_zone' }, 'en') === en['errors.code.out_of_zone']);
    check('English still shows the server\'s own sentence for an uncoded failure', errorMessage(tEn, new Error('Prices have changed. Please review your bag.'), 'en') === 'Prices have changed. Please review your bag.');
    check('Hindi never shows that English sentence: it shows the translated generic line', errorMessage(tHi, new Error('Prices have changed. Please review your bag.'), 'hi') === hi['errors.generic']);
    check('a developer line ("API /path 500") is never shown', errorMessage(tEn, new Error('API /orders 500'), 'en') === en['errors.generic']);
  }

  // ---------- Pseudo-locale ----------
  check('pseudo-locale keeps {{placeholders}} and nested $t()', pseudoString('Hello {{name}}, $t(a.b) <0>bold</0>') === '[Ĥéļļö {{name}}, $t(a.b) <0>ƀöļð</0>' + '·'.repeat(Math.ceil(9 * 0.35)) + ']');
  check('pseudo-locale leaves symbols alone and brackets words', pseudoString('₹') === '₹' && pseudoString('Save').startsWith('[Šàṽé'));
  {
    const px = flatten(pseudoLocalize(read('en')));
    check('pseudo-locale has every key, grows the text and keeps the placeholders', Object.keys(px).length === Object.keys(en).length && Object.keys(en).every(k => tokens(px[k]!) === tokens(en[k]!) && (px[k]!.length >= en[k]!.length)));
  }

  // ---------- Devanagari layout helpers ----------
  check('line height is raised to the Devanagari minimum, never lowered', safeLineHeight(14) === Math.round(14 * MIN_LINE_HEIGHT_RATIO) && safeLineHeight(14, 30) === 30 && MIN_LINE_HEIGHT_RATIO >= 1.3);
  check('the web font stack carries Devanagari-capable fonts after the Latin ones', /Noto Sans Devanagari/.test(WEB_FONT_STACK) && WEB_FONT_STACK.indexOf('Roboto') < WEB_FONT_STACK.indexOf('Devanagari'));

  console.log(`\n${passed} checks passed.`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
