// Every rule that turns a cart into a bill lives here, so the cart screen, checkout and the stored
// order can never disagree. The cart asks POST /api/cart/quote; createCheckout calls quote() again
// and refuses a checkout whose total no longer matches.
//
// Source of the rules: the founder's notebook (2026-09-24) —
//   * packaged goods are sold at MRP, which already includes GST (rate varies by item);
//   * restaurant food carries 5% GST on top, shown as CGST 2.5% + SGST 2.5%;
//   * handling and platform fees are separate bill lines whose amounts are not decided yet;
//   * GST on the delivery fee is not decided yet.
// Undecided amounts are 0 here and show nothing on the bill until someone sets them.
//
// Two kinds of cart (founder, 27 Sep 2026):
//   * food     — dishes from ONE restaurant, like Swiggy Food;
//   * shopping — groceries, shops, pharmacy and beauty from any number of stores.
// A cart is billed per store (each store becomes its own order at checkout, store.ts) and the
// checkout total is the sum. Delivery and the other fee rules apply to each store's part exactly as
// they used to apply to a whole order. A coupon counts against the checkout total, unless it
// belongs to one store (ol_coupons.store_id), when it counts against that store's part only.
import { assertWithinCaps } from './order-risk';
import { applyCoupon, findProduct, getCatalog, inCity, Product } from './catalog';
import { HttpError } from './http';

// Smart top-up: when one store's part of the cart is short of free delivery, pick that store's
// items that close the gap best — priced just above the gap (least overshoot), not already in the
// cart, best rated first. Only the same store: an item from another shop would start a new store
// order with its own delivery fee, so it could never close this gap. The customer sees the honest
// net cost of each (price minus the delivery fee it saves), so it's a suggestion, not an upsell.
async function topUps(city: string, storeId: string, inCart: Set<string>, gap: number): Promise<(Product & { net: number })[]> {
  const catalog = await getCatalog();
  return inCity(catalog.products, city)
    .filter(p => p.store_id === storeId && !inCart.has(p.id) && p.price >= gap)
    .sort((a, b) => (a.price - gap) - (b.price - gap) || b.rating - a.rating)
    .slice(0, 3)
    .map(p => ({ ...p, net: r2(p.price - PRICING.deliveryFee) }));
}

export const PRICING = {
  deliveryFee: 15,        // ₹ below the free-delivery threshold
  freeDeliveryFrom: 199,  // ₹ item total at which delivery becomes free
  handlingFee: 0,         // ₹ per order — undecided
  platformFee: 0,         // ₹ per order — undecided
  foodGstPct: 5,          // % added on restaurant food
  deliveryGstPct: 0,      // % on the delivery fee — undecided
};

// GST already inside the MRP of packaged goods, by category. Display only: it never changes what
// the customer pays. SAMPLE RATES — confirm each with the CA before launch; a product can later
// carry its own rate (HSN-specific) instead of its category's.
const INCLUDED_GST_BY_CATEGORY: Record<string, number> = {
  c1: 0,                                              // fresh fruits & vegetables
  c2: 5, c3: 5, c5: 5, c6: 5, c21: 5, c23: 5, c24: 5, // dairy, snacks, bakery, instant, sweets, dry fruits, cereals
  c25: 5, c26: 5, c29: 5, c32: 5,                     // atta/rice/dal, oils & ghee, tea & coffee, chocolates
  c7: 5, c13: 5, c14: 5, c17: 5, c31: 5, c22: 5, c28: 5, c18: 5, // personal care, wellness, hygiene, haircare, bath, puja, sports, fashion
  c8: 18, c15: 18, c16: 18, c19: 18, c20: 18, c27: 18, c30: 18,  // home needs, skincare, makeup, electronics, homeware, protein, cleaning
  c4: 40,                                             // aerated cold drinks
};
const DEFAULT_INCLUDED_GST = 5;

const r2 = (n: number) => Math.round(n * 100) / 100;

export type CartKind = 'food' | 'shopping';
// Which of the two carts a product belongs in. The app uses the same rule (src/cart.tsx).
export const cartKindOf = (department: string | undefined): CartKind => (department === 'food' ? 'food' : 'shopping');

export type BillLine = {
  id: string; name: string; weight: string; image: string; qty: number; price: number; mrp: number; store_id: string;
  department: string; gst_pct: number; gst_mode: 'included' | 'added'; line_total: number;
};
export type TaxSplit = { rate: number; taxable: number; cgst: number; sgst: number };
type TopUp = Product & { net: number };
// One store's part of the cart. At checkout it becomes one order, and only this store sees it.
export type StoreBill = {
  store_id: string; store_name: string; store_logo: string; delivery_time: string;
  lines: BillLine[];
  item_mrp_total: number; item_total: number;
  delivery_fee: number; delivery_fee_before_waiver: number; amount_to_free_delivery: number;
  handling_fee: number; platform_fee: number;
  gst_added: TaxSplit & { total: number };
  discount: number;    // this store's share of the coupon
  total: number;
  top_ups: TopUp[];    // this store's items that close its free-delivery gap
};
// The checkout: every amount is the sum over its stores.
export type Bill = {
  kind: CartKind;
  groups: StoreBill[];
  lines: BillLine[];
  item_mrp_total: number; item_total: number; mrp_savings: number;
  delivery_fee: number; delivery_fee_before_waiver: number; free_delivery_from: number; amount_to_free_delivery: number;
  handling_fee: number; platform_fee: number;
  gst_added: TaxSplit & { total: number };   // restaurant food: part of the total
  gst_included: TaxSplit[];                  // packaged goods: already inside item prices
  coupon: { code: string; label: string; ok: boolean; message: string } | null;
  discount: number;
  total: number;
  total_savings: number;
  top_ups: TopUp[];   // for older app versions: the first store that has suggestions
};

// A coupon's discount spread over the stores it applies to, in proportion to what each sells, in
// paise, with any leftover paisa on the biggest store — so the store orders add up to the checkout
// total exactly.
function share(discount: number, stores: StoreBill[]) {
  const paise = Math.round(discount * 100);
  const base = stores.reduce((s, g) => s + Math.round(g.item_total * 100), 0);
  let left = paise;
  for (const g of stores) { const part = base ? Math.floor(paise * Math.round(g.item_total * 100) / base) : 0; g.discount = part / 100; left -= part; }
  const biggest = stores.reduce((a, b) => (b.item_total > a.item_total ? b : a));
  biggest.discount = r2(biggest.discount + left / 100);
}

export async function quote(city: string, rawLines: unknown, rawCoupon: unknown): Promise<Bill> {
  if (!Array.isArray(rawLines) || rawLines.length === 0 || rawLines.length > 50) throw new HttpError(400, 'Your cart is empty or too large.');
  const lines: BillLine[] = await Promise.all(rawLines.map(async (raw: unknown) => {
    const line = raw as { id?: unknown; qty?: unknown };
    const product = typeof line.id === 'string' ? await findProduct(city, line.id) : undefined;
    if (!product) throw new HttpError(400, 'An item in your cart is no longer available. Please review your cart.');
    const qty = line.qty as number;
    if (!Number.isInteger(qty) || qty < 1) throw new HttpError(400, 'Please check the quantities in your cart.');
    const food = product.department === 'food';
    const gst = food ? PRICING.foodGstPct : INCLUDED_GST_BY_CATEGORY[product.category_id] ?? DEFAULT_INCLUDED_GST;
    return {
      id: product.id, name: product.name, weight: product.weight, image: product.image, qty,
      price: product.price, mrp: product.mrp, store_id: product.store_id, department: product.department,
      gst_pct: gst, gst_mode: food ? 'added' : 'included', line_total: r2(product.price * qty),
    };
  }));

  // Most of one item, and most items in one basket (order-risk.ts): refused before anything is priced or charged.
  assertWithinCaps(lines);

  // The cart rules, checked here too, so an older app version or a hand-made request gets the same
  // answer as the app: food is its own cart, and a food cart holds one restaurant.
  const food = lines.filter(l => cartKindOf(l.department) === 'food');
  if (food.length && food.length < lines.length) throw new HttpError(409, 'Food and shopping are checked out separately. Please place them as two orders.');
  if (new Set(food.map(l => l.store_id)).size > 1) throw new HttpError(409, 'Food comes from one restaurant per order. Please keep dishes from just one restaurant in your cart.');
  const kind: CartKind = food.length ? 'food' : 'shopping';

  // One bill per store, in the order the stores first appear in the cart.
  const catalog = await getCatalog();
  const inCart = new Set(lines.map(l => l.id));
  const groups: StoreBill[] = await Promise.all([...new Set(lines.map(l => l.store_id))].map(async id => {
    const own = lines.filter(l => l.store_id === id);
    const store = catalog.stores.find(s => s.id === id);
    const item_total = r2(own.reduce((s, l) => s + l.line_total, 0));
    const free = item_total >= PRICING.freeDeliveryFrom;
    const delivery_fee = free ? 0 : PRICING.deliveryFee;
    const deliveryGst = r2(delivery_fee * PRICING.deliveryGstPct / 100);
    // Restaurant food: 5% on the food subtotal, split evenly between CGST and SGST.
    const foodTaxable = r2(own.filter(l => l.gst_mode === 'added').reduce((s, l) => s + l.line_total, 0));
    const foodGst = r2(foodTaxable * PRICING.foodGstPct / 100);
    const gap = free ? 0 : r2(PRICING.freeDeliveryFrom - item_total);
    return {
      store_id: id, store_name: store?.name ?? 'Store', store_logo: store?.logo ?? '', delivery_time: store?.delivery_time ?? '',
      lines: own, item_mrp_total: r2(own.reduce((s, l) => s + l.mrp * l.qty, 0)), item_total,
      delivery_fee, delivery_fee_before_waiver: PRICING.deliveryFee, amount_to_free_delivery: gap,
      handling_fee: PRICING.handlingFee, platform_fee: PRICING.platformFee,
      gst_added: { rate: PRICING.foodGstPct, taxable: foodTaxable, cgst: r2(foodGst / 2), sgst: r2(foodGst - r2(foodGst / 2)), total: r2(foodGst + deliveryGst) },
      discount: 0, total: 0,
      top_ups: gap > 0 ? await topUps(city, id, inCart, gap) : [],
    };
  }));
  const sum = (pick: (g: StoreBill) => number) => r2(groups.reduce((s, g) => s + pick(g), 0));
  const item_total = sum(g => g.item_total);
  const item_mrp_total = sum(g => g.item_mrp_total);

  let coupon: Bill['coupon'] = null;
  const code = typeof rawCoupon === 'string' ? rawCoupon.trim().slice(0, 30).toUpperCase() : '';
  if (code) {
    const owner = (catalog.coupons.find(c => c.code === code) as { store_id?: string | null } | undefined)?.store_id || null;
    const target = owner ? groups.filter(g => g.store_id === owner) : groups;
    if (!target.length) {
      const name = catalog.stores.find(s => s.id === owner)?.name ?? 'one store';
      coupon = { code, label: '', ok: false, message: `This coupon is only for ${name}. Add something from ${name} to use it.` };
    } else {
      const result = await applyCoupon(code, r2(target.reduce((s, g) => s + g.item_total, 0)));
      coupon = { code, label: result.coupon?.label ?? '', ok: result.ok, message: result.message };
      if (result.ok) share(r2(result.discount), target);
    }
  }
  for (const g of groups) g.total = Math.max(r2(g.item_total + g.delivery_fee + g.handling_fee + g.platform_fee + g.gst_added.total - g.discount), 0);

  // Packaged goods: back the tax out of the inclusive price, grouped by rate (display only).
  const byRate = new Map<number, number>();
  for (const l of lines) if (l.gst_mode === 'included' && l.gst_pct > 0) byRate.set(l.gst_pct, (byRate.get(l.gst_pct) ?? 0) + l.line_total);
  const gst_included: TaxSplit[] = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, gross]) => {
    const tax = r2(gross * rate / (100 + rate));
    return { rate, taxable: r2(gross - tax), cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)) };
  });

  const discount = sum(g => g.discount);
  const waived = sum(g => (g.delivery_fee === 0 ? g.delivery_fee_before_waiver : 0));
  return {
    kind, groups, lines,
    item_mrp_total, item_total, mrp_savings: r2(item_mrp_total - item_total),
    delivery_fee: sum(g => g.delivery_fee), delivery_fee_before_waiver: sum(g => g.delivery_fee_before_waiver),
    free_delivery_from: PRICING.freeDeliveryFrom, amount_to_free_delivery: sum(g => g.amount_to_free_delivery),
    handling_fee: sum(g => g.handling_fee), platform_fee: sum(g => g.platform_fee),
    gst_added: { rate: PRICING.foodGstPct, taxable: sum(g => g.gst_added.taxable), cgst: sum(g => g.gst_added.cgst), sgst: sum(g => g.gst_added.sgst), total: sum(g => g.gst_added.total) },
    gst_included, coupon, discount, total: sum(g => g.total),
    total_savings: r2(item_mrp_total - item_total + discount + waived),
    top_ups: groups.find(g => g.top_ups.length)?.top_ups ?? [],
  };
}
