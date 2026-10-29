// The bag holds two carts (founder, 27 Sep 2026), paid for separately:
//   * Food — dishes from ONE restaurant, like Swiggy Food. A dish from another restaurant asks first
//     ("Replace cart?", ReplaceCartSheet); the server refuses a two-restaurant food checkout too.
//   * Shopping — groceries, shops, pharmacy and beauty from any number of stores. The cart screen
//     groups it by store, and at checkout the server makes one order per store, paid together.
// The cart screen shows one cart at a time (`kind`, the one last added to) with a switch when both
// have items. `items` and the totals cover both carts, for the bag badge and the floating cart.
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, mediaUrl, Store } from './api';
import { ReplaceCartSheet } from './components/replace-cart-sheet';
import { COMING_SOON_ALL, announceComingSoon } from './coming-soon-mode';

export type CartKind = 'food' | 'shopping';
// Same rule as the server (server/pricing.ts cartKindOf).
export const cartKindOf = (p: { department?: string }): CartKind => (p.department === 'food' ? 'food' : 'shopping');

export type CartProduct = {
  id: string;
  name: string;
  weight: string;
  price: number;
  mrp: number;
  image: string;
  department?: string;
  category_id?: string;
  brand_id?: string;
  store_id?: string;
};

export type CartItem = CartProduct & { qty: number };
type Origin = { x: number; y: number };
type Line = { product: CartProduct; qty: number };
type Carts = Record<CartKind, CartItem[]>;

type CartContextType = {
  items: CartItem[];
  carts: Carts;
  kind: CartKind;
  setKind: (kind: CartKind) => void;
  add: (p: CartProduct, origin?: Origin) => void;
  addMany: (lines: Line[]) => void;
  lastAdded: { product: CartProduct; origin?: Origin; revision: number } | null;
  remove: (id: string) => void;
  clear: (kind?: CartKind) => void;
  qtyOf: (id: string) => number;
  totalItems: number;
  totalPrice: number;
  totalMrp: number;
};

const CartContext = createContext<CartContextType | null>(null);
// Product cards need only the add/remove buttons (which never change) and their own quantity.
// They read those here instead of useCart(), so adding one item redraws one card, not every card.
type CartActions = Pick<CartContextType, 'add' | 'addMany' | 'remove'>;
const CartActionsContext = createContext<CartActions | null>(null);
const qtyStore = { qty: new Map<string, number>(), listeners: new Set<() => void>() };
const subscribeQty = (l: () => void) => { qtyStore.listeners.add(l); return () => { qtyStore.listeners.delete(l); }; };
const KEY = "onelatur.cart.v2";
const OLD_KEY = "onelatur.cart.v1"; // one list, before the two carts
const EMPTY: Carts = { food: [], shopping: [] };
// Most of one item per order; the server refuses more (server/order-risk.ts ORDER_CAPS). The cart stops here so the
// customer never builds a basket that checkout will refuse.
export const MAX_LINE_QTY: Record<CartKind, number> = { food: 20, shopping: 25 };

const freshImage = (item: CartItem): CartItem => { const key = item.image?.split('/api/media/')[1]; return { ...item, image: item.id === 'p6' ? mediaUrl('snacks') : key ? mediaUrl(key) : item.image }; };
// Every item in the cart its department says.
const sorted = (all: CartItem[]): Carts => ({ food: all.filter(i => cartKindOf(i) === 'food'), shopping: all.filter(i => cartKindOf(i) === 'shopping') });

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [carts, setCarts] = useState<Carts>(EMPTY);
  const [kind, setKind] = useState<CartKind>('shopping');
  const [hydrated, setHydrated] = useState(false);
  const [lastAdded, setLastAdded] = useState<CartContextType['lastAdded']>(null);
  // A food add that would mix restaurants waits here for the customer's answer.
  const [pending, setPending] = useState<{ lines: Line[]; origin?: Origin; from?: string; to?: string } | null>(null);
  const [storeNames, setStoreNames] = useState<Map<string, string>>(new Map());
  const catalog = useRef(new Map<string, CartProduct>()); // fills in store and department when a caller leaves them out
  const current = useRef(carts);
  // Kept current after each commit, not during render: React may render and throw a render away, and a ref written there would leak it.
  useLayoutEffect(() => { current.current = carts; });

  useEffect(() => {
    // Coming-soon build: the bag always starts empty and is never saved, so no old "2 items" bar shows up.
    if (COMING_SOON_ALL) return;
    AsyncStorage.multiGet([KEY, OLD_KEY]).then(([[, saved], [, old]]) => {
      try {
        if (saved) {
          const s = JSON.parse(saved);
          setCarts({ food: (s.food ?? []).map(freshImage), shopping: (s.shopping ?? []).map(freshImage) });
          if (s.kind === 'food' || s.kind === 'shopping') setKind(s.kind);
        } else if (old) {
          setCarts(sorted(JSON.parse(old).map(freshImage)));
          AsyncStorage.removeItem(OLD_KEY).catch(() => {});
        }
      } catch {}
      setHydrated(true);
      // Refresh image links, and fill in store and department for items saved without them (older
      // carts, reorders) — moving any that turn out to belong in the other cart.
      api<CartProduct[]>('/products').then(products => {
        catalog.current = new Map(products.map(p => [p.id, p]));
        setCarts(c => sorted([...c.food, ...c.shopping].map(item => {
          const p = catalog.current.get(item.id);
          return p ? { ...item, image: p.image || item.image, store_id: p.store_id, department: p.department } : item;
        })));
      }).catch(() => {});
      api<Store[]>('/stores').then(list => setStoreNames(new Map(list.map(s => [s.id, s.name])))).catch(() => {});
    }).catch(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (hydrated) AsyncStorage.setItem(KEY, JSON.stringify({ ...carts, kind })).catch(() => {});
  }, [carts, kind, hydrated]);

  const put = (k: CartKind, lines: Line[], origin?: Origin) => {
    setCarts(prev => {
      let list = prev[k];
      for (const { product, qty } of lines) {
        list = list.some(i => i.id === product.id) ? list.map(i => (i.id === product.id ? { ...i, qty: Math.min(MAX_LINE_QTY[k], i.qty + qty) } : i)) : [...list, { ...product, qty: Math.min(MAX_LINE_QTY[k], qty) }];
      }
      return { ...prev, [k]: list };
    });
    setKind(k);
    setLastAdded(prev => ({ product: lines[lines.length - 1].product, origin, revision: (prev?.revision || 0) + 1 }));
  };

  // Adds to the right cart; a reorder can hold both kinds. Food from a second restaurant asks first.
  const addMany = (raw: Line[], origin?: Origin) => {
    // Coming-soon build: nothing goes into the bag; the "almost ready" toast says why.
    if (COMING_SOON_ALL) { announceComingSoon(); return; }
    const lines = raw.filter(l => l.qty > 0).map(l => {
      const known = catalog.current.get(l.product.id);
      return { ...l, product: { ...l.product, store_id: l.product.store_id ?? known?.store_id, department: l.product.department ?? known?.department } };
    });
    const shopping = lines.filter(l => cartKindOf(l.product) === 'shopping');
    const food = lines.filter(l => cartKindOf(l.product) === 'food');
    if (shopping.length) put('shopping', shopping, origin);
    if (!food.length) return;
    const to = food[0].product.store_id;
    const from = current.current.food.find(i => i.store_id && to && i.store_id !== to)?.store_id;
    if (from) setPending({ lines: food, origin, from: storeNames.get(from), to: storeNames.get(to!) }); // names the stores gave; the sheet words the rest
    else put('food', food, origin);
  };
  const add = (p: CartProduct, origin?: Origin) => addMany([{ product: p, qty: 1 }], origin);
  const replaceFood = () => {
    if (!pending) return;
    setCarts(prev => ({ ...prev, food: [] }));
    put('food', pending.lines, pending.origin);
    setPending(null);
  };

  const remove = (id: string) => {
    setCarts(prev => {
      const k: CartKind = prev.food.some(i => i.id === id) ? 'food' : 'shopping';
      const ex = prev[k].find(i => i.id === id);
      if (!ex) return prev;
      return { ...prev, [k]: ex.qty <= 1 ? prev[k].filter(i => i.id !== id) : prev[k].map(i => (i.id === id ? { ...i, qty: i.qty - 1 } : i)) };
    });
  };
  const clear = (k?: CartKind) => setCarts(prev => (k ? { ...prev, [k]: [] } : EMPTY));
  // Stable wrappers: the functions above are re-created each render, the wrappers never are.
  const latest = useRef({ add, addMany, remove, clear });
  useLayoutEffect(() => { latest.current = { add, addMany, remove, clear }; });
  const stableAdd = useCallback((p: CartProduct, origin?: Origin) => latest.current.add(p, origin), []);
  const stableAddMany = useCallback((lines: Line[]) => latest.current.addMany(lines), []);
  const stableRemove = useCallback((id: string) => latest.current.remove(id), []);
  const stableClear = useCallback((k?: CartKind) => latest.current.clear(k), []);
  const actions = useMemo(() => ({ add: stableAdd, addMany: stableAddMany, remove: stableRemove }), [stableAdd, stableAddMany, stableRemove]);

  const value = useMemo(() => {
    const items = [...carts.food, ...carts.shopping];
    const qty = new Map(items.map(i => [i.id, i.qty]));
    return {
      items, carts, kind, setKind, add: stableAdd, addMany: stableAddMany, remove: stableRemove, clear: stableClear, lastAdded,
      qtyOf: (id: string) => qty.get(id) ?? 0,
      totalItems: items.reduce((a, b) => a + b.qty, 0),
      totalPrice: items.reduce((a, b) => a + b.qty * b.price, 0),
      totalMrp: items.reduce((a, b) => a + b.qty * b.mrp, 0),
    };
  }, [carts, kind, lastAdded, stableAdd, stableAddMany, stableRemove, stableClear]);
  useLayoutEffect(() => {
    qtyStore.qty = new Map(value.items.map(i => [i.id, i.qty]));
    qtyStore.listeners.forEach(l => l());
  }, [value.items]);

  return (
    <CartActionsContext.Provider value={actions}>
      <CartContext.Provider value={value}>
        {children}
        {pending && <ReplaceCartSheet from={pending.from} to={pending.to} onKeep={() => setPending(null)} onReplace={replaceFood} />}
      </CartContext.Provider>
    </CartActionsContext.Provider>
  );
}

export function useCartActions() {
  const c = useContext(CartActionsContext);
  if (!c) throw new Error("useCartActions must be used inside CartProvider"); // i18n-ignore: developer error
  return c;
}
// Quantity of one product; re-renders only when that product's quantity changes.
export function useCartQty(id: string) {
  return useSyncExternalStore(subscribeQty, () => qtyStore.qty.get(id) ?? 0, () => 0);
}

export function useCart() {
  const c = useContext(CartContext);
  if (!c) throw new Error("useCart must be used inside CartProvider"); // i18n-ignore: developer error
  return c;
}
