// "₹6/100 g" style unit prices from the pack-size text ("500 g", "1 kg", "350 ml", "1 dozen",
// "Pack of 6"…). Used on the product page and in Compare so different pack sizes can be weighed up
// fairly. Returns null when the size can't be read, rather than guessing.
//
// unitPrice() is language-free: it returns the numbers. unitPriceLabel() turns them into the words a person
// reads ("₹6/100 g" or "₹6 प्रति 100 g") with the caller's own `t` and `fmt`, at render time.
import type { TFunction } from 'i18next';
import type { Formatter } from './i18n';

export type UnitBase = 'g' | 'ml' | 'pc';
/** `amount` is ₹ per 100 g, per 100 ml or per piece, tidied for display; `perBase` is the exact ₹ per single g / ml / piece. */
export type UnitPrice = { amount: number; perBase: number; base: UnitBase };

export function unitPrice(price: number, weight: string): UnitPrice | null {
  const text = weight.toLowerCase().replace(/,/g, '');
  const m = text.match(/(\d+(?:\.\d+)?)\s*(kg|g|gm|grams?|l|ltr|litres?|ml|dozen|pcs?|pieces?)\b/);
  const pack = text.match(/(?:pack of|x)\s*(\d+)/);
  if (m) {
    const n = parseFloat(m[1]); const unit = m[2];
    const count = pack ? parseInt(pack[1], 10) : 1;
    if (!n) return null;
    if (/^(kg|g|gm|grams?)$/.test(unit)) {
      const grams = (unit === 'kg' ? n * 1000 : n) * count;
      return { amount: tidy(price / grams * 100), perBase: price / grams, base: 'g' };
    }
    if (/^(l|ltr|litres?|ml)$/.test(unit)) {
      const ml = (unit === 'ml' ? n : n * 1000) * count;
      return { amount: tidy(price / ml * 100), perBase: price / ml, base: 'ml' };
    }
    const pieces = (unit === 'dozen' ? n * 12 : n) * count;
    return { amount: tidy(price / pieces), perBase: price / pieces, base: 'pc' };
  }
  if (pack) { const pieces = parseInt(pack[1], 10); return pieces ? { amount: tidy(price / pieces), perBase: price / pieces, base: 'pc' } : null; }
  return null;
}

/** "₹6/100 g", "₹1.20/100 ml", "₹8/piece" in the current language. g / ml stay as the pack text writes them. */
export function unitPriceLabel(u: Pick<UnitPrice, 'amount' | 'base'>, t: TFunction, fmt: Formatter): string {
  const price = fmt.money(u.amount);
  return u.base === 'pc' ? t('unitPrice.perPiece', { price }) : t('unitPrice.per100', { price, unit: u.base });
}

const tidy = (n: number) => (n >= 10 ? Math.round(n) : Number(n.toFixed(1)));
