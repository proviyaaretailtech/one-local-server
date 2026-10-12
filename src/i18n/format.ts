// Numbers, money, distance, time and dates — one place, so every screen shows ₹ and dates the same way and
// they follow the language instantly. No React in here (hooks.ts wraps it).
//
//   - Money: ₹ prefix, Indian grouping (1,23,456) in every language.
//   - Digits: Latin (0-9) by default, also in Hindi. Devanagari digits are an option (`numerals: 'deva'`), off by default.
//   - Dates and times: always India time (Asia/Kolkata), whatever the phone's own zone says.
//   - Words ("km", "min", "Today") come from the catalogue (format.* keys), so Hindi is reviewed with the rest.
import type { TFunction } from 'i18next';
import { intlTag, localeMeta } from './locales';

export const TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 3600_000;
export type Numerals = 'latn' | 'deva';
export type FormatContext = { lng: string; t: TFunction; numerals?: Numerals };

const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

/** Digits in the script the person reads: Latin unless Devanagari digits were asked for (Hindi only). */
export function localizeDigits(text: string, lng: string, numerals: Numerals = 'latn'): string {
  if (numerals !== 'deva' || localeMeta(lng).script !== 'devanagari') return text;
  return text.replace(/\d/g, d => DEVANAGARI_DIGITS[Number(d)]!);
}

/** 1234567 -> "12,34,567" (Indian grouping: the last three digits, then pairs). Digits only in, digits only out. */
export function groupIndian(integerDigits: string): string {
  if (integerDigits.length <= 3) return integerDigits;
  const last3 = integerDigits.slice(-3);
  const rest = integerDigits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

type NumberOptions = { maxFractionDigits?: number; minFractionDigits?: number };

function plainNumber(value: number, { maxFractionDigits = 0, minFractionDigits = 0 }: NumberOptions = {}): string {
  const negative = value < 0 && Math.abs(value) >= 0.5 * 10 ** -maxFractionDigits;
  const fixed = Math.abs(value).toFixed(maxFractionDigits);
  let [integer = '0', fraction = ''] = fixed.split('.');
  while (fraction.length > minFractionDigits && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  return `${negative ? '−' : ''}${groupIndian(integer)}${fraction ? `.${fraction}` : ''}`;
}

export function formatNumber(value: number, ctx: FormatContext, options?: NumberOptions): string {
  if (!Number.isFinite(value)) return '—';
  return localizeDigits(plainNumber(value, options), ctx.lng, ctx.numerals);
}

/**
 * Rupees as people write them: ₹249, ₹1,23,456, ₹99.50. Whole rupees show no decimals; anything else shows two
 * (what the cart has always done). Negative amounts read −₹50.
 */
export function formatMoney(rupees: number, ctx: FormatContext, options: { decimals?: 'auto' | 0 | 2 } = {}): string {
  if (!Number.isFinite(rupees)) return '—';
  const decimals = options.decimals ?? 'auto';
  const fraction = decimals === 'auto' ? (Number.isInteger(Math.round(rupees * 100) / 100) ? 0 : 2) : decimals;
  const text = plainNumber(rupees, { maxFractionDigits: fraction, minFractionDigits: fraction });
  const out = text.startsWith('−') ? `−₹${text.slice(1)}` : `₹${text}`;
  return localizeDigits(out, ctx.lng, ctx.numerals);
}

/** The server's integer `*_minor` twin (paise). */
export const formatMoneyMinor = (paise: number, ctx: FormatContext, options?: { decimals?: 'auto' | 0 | 2 }) => formatMoney(paise / 100, ctx, options);

export function formatPercent(value: number, ctx: FormatContext): string {
  return Number.isFinite(value) ? localizeDigits(`${plainNumber(value, { maxFractionDigits: 1 })}%`, ctx.lng, ctx.numerals) : '—';
}

/** Distance in kilometres: "350 m" under a kilometre, "1.2 km" up to 10, "14 km" beyond. */
export function formatDistance(km: number, ctx: FormatContext): string {
  if (!Number.isFinite(km) || km < 0) return '—';
  if (km < 1) return ctx.t('format.distanceM', { value: formatNumber(Math.round(km * 1000), ctx) });
  const value = formatNumber(km < 10 ? Math.round(km * 10) / 10 : Math.round(km), ctx, { maxFractionDigits: 1 });
  return ctx.t('format.distanceKm', { value });
}

/** Minutes: "12 min", "1 hr 5 min". */
export function formatEta(minutes: number, ctx: FormatContext): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  const total = Math.max(1, Math.round(minutes));
  if (total < 60) return ctx.t('format.minutes', { count: total, value: formatNumber(total, ctx) });
  const h = Math.floor(total / 60); const m = total % 60;
  return m === 0
    ? ctx.t('format.hours', { count: h, value: formatNumber(h, ctx) })
    : ctx.t('format.hoursMinutes', { h: formatNumber(h, ctx), m: formatNumber(m, ctx) });
}

/** "25–30 min". */
export function formatEtaRange(from: number, to: number, ctx: FormatContext): string {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return '—';
  if (Math.round(from) === Math.round(to)) return formatEta(from, ctx);
  return ctx.t('format.etaRange', { from: formatNumber(Math.round(from), ctx), to: formatNumber(Math.round(to), ctx) });
}

/**
 * The server still writes a store's delivery time as text ("10 min", "25-30 mins"). When it has that shape it is
 * shown in the reader's language ("10 मिनट"); any other text (or a later numeric field) is shown as it came.
 */
export function formatDeliveryTime(raw: unknown, ctx: FormatContext): string {
  if (typeof raw !== 'string') return typeof raw === 'number' ? formatEta(raw, ctx) : '';
  const m = raw.trim().match(/^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s*(?:min|mins|minutes?)?$/i);
  if (!m) return raw;
  return m[2] ? formatEtaRange(Number(m[1]), Number(m[2]), ctx) : formatEta(Number(m[1]), ctx);
}

export type DateStyle = 'short' | 'medium' | 'long' | 'time' | 'dateTime' | 'weekday' | 'weekdayShort';
const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: 'numeric', month: 'short' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  time: { hour: 'numeric', minute: '2-digit', hour12: true },
  dateTime: { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true },
  weekday: { weekday: 'short', day: 'numeric', month: 'short' },
  weekdayShort: { weekday: 'short' }, // "Tue" / "मंगल"
};

const toDate = (value: Date | string | number): Date => (value instanceof Date ? value : new Date(value));

export function formatDate(value: Date | string | number, ctx: FormatContext, style: DateStyle = 'medium'): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  const options = { ...DATE_OPTIONS[style], timeZone: TIME_ZONE };
  const attempts: (() => string)[] = [
    () => new Intl.DateTimeFormat(intlTag(ctx.lng, ctx.numerals), options).format(date),
    // An engine without this language's date data: English dates are better than none.
    () => new Intl.DateTimeFormat('en-IN', options).format(date),
    // An engine without time-zone data: shift to India time by hand and read it as UTC.
    () => new Intl.DateTimeFormat('en-IN', { ...DATE_OPTIONS[style], timeZone: 'UTC' }).format(new Date(date.getTime() + IST_OFFSET_MS)),
  ];
  for (const attempt of attempts) { try { return attempt(); } catch { /* try the next */ } }
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

/** "Today", "Yesterday", "Tomorrow", else the medium date — judged on the India calendar day. */
export function formatRelativeDay(value: Date | string | number, ctx: FormatContext, now: Date = new Date()): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  const day = (d: Date) => Math.floor((d.getTime() + IST_OFFSET_MS) / 86_400_000); // days since epoch, India calendar
  const diff = day(date) - day(now);
  if (diff === 0) return ctx.t('format.today');
  if (diff === -1) return ctx.t('format.yesterday');
  if (diff === 1) return ctx.t('format.tomorrow');
  return formatDate(date, ctx, 'medium');
}

export type Formatter = ReturnType<typeof makeFormatter>;

/** Everything above with the language and numerals bound in. */
export function makeFormatter(ctx: FormatContext) {
  return {
    number: (v: number, o?: NumberOptions) => formatNumber(v, ctx, o),
    money: (v: number, o?: { decimals?: 'auto' | 0 | 2 }) => formatMoney(v, ctx, o),
    moneyMinor: (v: number, o?: { decimals?: 'auto' | 0 | 2 }) => formatMoneyMinor(v, ctx, o),
    percent: (v: number) => formatPercent(v, ctx),
    distance: (km: number) => formatDistance(km, ctx),
    eta: (minutes: number) => formatEta(minutes, ctx),
    etaRange: (from: number, to: number) => formatEtaRange(from, to, ctx),
    deliveryTime: (raw: unknown) => formatDeliveryTime(raw, ctx),
    date: (v: Date | string | number, style?: DateStyle) => formatDate(v, ctx, style),
    time: (v: Date | string | number) => formatDate(v, ctx, 'time'),
    dateTime: (v: Date | string | number) => formatDate(v, ctx, 'dateTime'),
    relativeDay: (v: Date | string | number) => formatRelativeDay(v, ctx),
  };
}
