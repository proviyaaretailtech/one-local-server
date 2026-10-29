import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { accessToken } from './lib/supabase';
import { updateHeaders } from './app-identity';
import { isNetworkError, reportNetworkFailure, reportNetworkSuccess } from './network/online-state';
import { noteResponse } from './network/app-blocked-state';
import { COMING_SOON_ALL, announceComingSoon, isAlwaysOpenApi } from './coming-soon-mode';
// backendUrl is injected server-side via app.config.ts → extra; never use EXPO_PUBLIC_ vars for secrets.
// In development on a phone (Expo Go), fall back to the dev server that served the app,
// which also serves app/api.
const devServer = Constants.expoConfig?.hostUri ? `http://${Constants.expoConfig.hostUri}` : '';
const configuredBackend = (Constants.expoConfig?.extra?.backendUrl || devServer).replace(/\/$/, '');
// On web the API is served by this same Expo Router app (app/api), so requests stay
// same-origin; native apps use the configured backend URL.
export const BACKEND = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : configuredBackend;
export const API = BACKEND + '/api';
export const mediaUrl = (key: string) => `${API}/media/${key}`;
function resolveMedia(value: any): any {
  if (typeof value === 'string') { const media = value.match(/^(?:https?:\/\/[^/]+)?\/api\/media\/(.+)$/); return media ? mediaUrl(media[1]) : value; }
  if (Array.isArray(value)) return value.map(resolveMedia);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveMedia(v)]));
  return value;
}

// A random id this device creates once. Until sign-in exists it is what keeps one
// customer's orders private from another's (the server stores only its hash).
const CUSTOMER_KEY = 'onecity.customer-key.v1';
export function randomId(bytes = 24): string {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  const a = new Uint8Array(bytes);
  if (c?.getRandomValues) c.getRandomValues(a); else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
let customerKey: Promise<string> | null = null;
// After "Clear this phone" (src/privacy.ts): the next request creates a new key.
export function forgetCustomerKey() { customerKey = null; }
function getCustomerKey(): Promise<string> {
  return (customerKey ??= AsyncStorage.getItem(CUSTOMER_KEY).then(async saved => {
    if (saved) return saved;
    const key = randomId();
    await AsyncStorage.setItem(CUSTOMER_KEY, key);
    return key;
  }).catch(() => randomId()));
}

// Every call says which device it is and, when signed in, who the customer is.
// Exported for the payment WebView, which loads its page with these same headers.
export async function identity(): Promise<Record<string, string>> {
  const [key, token] = await Promise.all([getCustomerKey(), accessToken().catch(() => null)]);
  return token ? { ...updateHeaders, 'X-Customer-Key': key, Authorization: `Bearer ${token}` } : { ...updateHeaders, 'X-Customer-Key': key };
}

// `code` is the server's machine-readable reason ('outside_delivery_area'); screens show a translated sentence for
// it with useErrorMessage() / errorMessage() from src/i18n instead of the English `message`.
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

// Every call to our server goes through here: a fetch that never reached the server tells the offline detector
// (src/network/online-state.ts); any answer says we are online, and a 426 / maintenance-503 blocks the app
// (src/network/app-blocked-state.ts). The response and any error are passed on unchanged.
async function send(url: string, init?: RequestInit): Promise<Response> {
  let r: Response;
  try { r = await fetch(url, init); } catch (e) { if (isNetworkError(e)) reportNetworkFailure(); throw e; }
  reportNetworkSuccess();
  await noteResponse(r).catch(() => {});
  return r;
}

// Like api(), but failures carry the server's own message (the `detail` field).
export async function apiGet<T>(path: string): Promise<T> {
  const r = await send(`${API}${path}`, { headers: await identity() });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, typeof body?.detail === 'string' ? body.detail : 'Something went wrong. Please try again.', typeof body?.code === 'string' ? body.code : undefined); // i18n-ignore (fallback for the English detail; screens map status/code)
  return resolveMedia(body);
}

export async function api<T>(path: string): Promise<T> {
  const r = await send(`${API}${path}`, { headers: await identity() });
  if (!r.ok) throw new ApiError(r.status, `API ${path} ${r.status}`);
  return resolveMedia(await r.json());
}

export type Category = { id: string; name: string; emoji: string; color: string; department: string; image: string };
export type DiscoverChip = { id: string; label: string; emoji: string; color: string };
export type Banner = { id: string; title: string; subtitle: string; image: string; bg: string };
export type Product = {
  id: string; name: string; weight: string; price: number; mrp: number;
  image: string; category_id: string; store_id: string;
  delivery_min: number; discount_pct?: number | null; rating: number;
  department?: string; brand_id?: string;
};
export type StoreMedia = { type: "video" | "image"; url: string; thumbnail?: string; video_web?: string };
export type Store = {
  id: string; name: string; logo: string; tagline: string;
  delivery_time: string; rating: number; tags: string[]; media: StoreMedia[];
};

export type Coupon = {
  code: string; label: string; kind: "flat" | "pct"; value: number;
  min_order: number; description: string;
};

export type CouponResult = {
  ok: boolean; discount: number; coupon?: Coupon | null; message: string;
};

export type OrderItem = {
  id: string; name: string; weight: string; price: number; mrp: number; image: string; qty: number;
};

// Where an order goes (server/store.ts): the chosen address, its map point when known, rider notes.
export type DeliveryAddress = { label: string; text: string; lat: number | null; lng: number | null; notes: string };

export type Order = {
  id: string;
  // Orders placed together (one per store) share a checkout; older orders have none.
  checkout_id?: string | null;
  store_id?: string | null;
  store_name?: string;
  address?: DeliveryAddress | null;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  delivery_fee: number;
  gst?: number;
  total: number;
  coupon_code?: string | null;
  // Online methods are what Razorpay reported for the payment (server/payments.ts).
  payment_method?: 'cod' | 'upi' | 'card' | 'netbanking' | 'wallet' | 'paylater' | 'emi' | 'cardless_emi';
  payment_status?: 'not_charged' | 'pending' | 'paid' | 'failed' | 'refunded';
  status: string;
  rider_name: string;
  rider_phone: string;
  eta_minutes: number;
  created_at: string;
};

// One payment for one or more store orders (POST /api/checkouts, GET /api/checkouts/:id).
export type Checkout = {
  id: string; kind: 'food' | 'shopping'; item_total: number; discount: number; delivery_fee: number; total: number;
  coupon_code: string | null; payment_method: NonNullable<Order['payment_method']>; payment_status: NonNullable<Order['payment_status']>;
  created_at: string; orders: Order[];
};

// POST /api/payments/order: our checkout (payment pending) plus what Razorpay Checkout opens on.
// `checkout` holds no secrets — key_id is Razorpay's public key; the secret never leaves the server.
// order_id is the checkout's first store order (what older app versions used).
export type PaymentStart = {
  order_id: string; checkout_id: string; order_ids: string[]; payment_status: NonNullable<Order['payment_status']>;
  razorpay_order_id: string; key_id: string; amount: number; currency: 'INR';
  prefill: { name: string; email: string; contact: string };
  checkout: Record<string, unknown>;
};
export type PaymentResult =
  | { type: 'success'; razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }
  | { type: 'dismiss' }
  | { type: 'failed'; reason?: string };

export async function apiPost<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  // Coming-soon build: no write reaches the server (carts, orders, sign-up, profile edits).
  if (COMING_SOON_ALL && !isAlwaysOpenApi(path)) { announceComingSoon(); throw new ApiError(501, 'Coming soon', 'coming_soon'); } // i18n-ignore (never shown: the banner says it)
  const r = await send(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await identity()), ...headers },
    body: JSON.stringify(body),
  });
  // Surface the server's own message ("Prices have changed…") instead of a bare status code.
  if (!r.ok) { const body = await r.json().catch(() => null); const detail = body?.detail; throw new ApiError(r.status, typeof detail === 'string' ? detail : `API ${path} ${r.status}`, typeof body?.code === 'string' ? body.code : undefined); }
  return resolveMedia(await r.json());
}

// The cart's bill as the server works it out (server/pricing.ts): one part per store, then the sums.
export type TaxSplit = { rate: number; taxable: number; cgst: number; sgst: number };
export type StoreBill = {
  store_id: string; store_name: string; store_logo: string; delivery_time: string;
  item_mrp_total: number; item_total: number;
  delivery_fee: number; delivery_fee_before_waiver: number; amount_to_free_delivery: number;
  handling_fee: number; platform_fee: number; gst_added: TaxSplit & { total: number };
  discount: number; total: number; top_ups: (Product & { net: number })[];
};
export type Bill = {
  kind: 'food' | 'shopping'; groups: StoreBill[];
  item_mrp_total: number; item_total: number; mrp_savings: number;
  delivery_fee: number; delivery_fee_before_waiver: number; free_delivery_from: number; amount_to_free_delivery: number;
  handling_fee: number; platform_fee: number;
  gst_added: TaxSplit & { total: number }; gst_included: TaxSplit[];
  coupon: { code: string; label: string; ok: boolean; message: string } | null;
  discount: number; total: number; total_savings: number;
  top_ups: (Product & { net: number })[];
};

export type Brand = { id: string; name: string; department: string; logo: string; image: string; tagline: string };
export type EventListing = { id: string; title: string; kind: string; subtitle: string; venue: string; price: number; image: string; tag: string; slots: string[] };
export type ThemedStore = { id: string; name: string; subtitle: string; eyebrow: string; categories: string[]; icon: string; image: string; sections: string[] };
export type Catalog = { brands: Brand[]; products: Product[]; categories: Category[]; events: EventListing[]; themed_stores: ThemedStore[] };
export type Reel = { id: string; video: string; video_web: string; product: Product; caption: string; creator: string; likes: number; tag: string; brand: Brand };
export type AISearchResult = { query: string; product_ids: string[]; explanation: string; transcript?: string };
export async function uploadSearch(mode: 'image' | 'voice', uri: string, name: string, type: string, signal: AbortSignal): Promise<AISearchResult> {
  const { Platform } = await import('react-native');
  const form = new FormData();
  if (Platform.OS === 'web') { const response = await fetch(uri); form.append('file', await response.blob(), name); }
  else form.append('file', { uri, name, type } as any);
  const response = await send(`${API}/search/${mode}`, { method: 'POST', body: form, signal });
  const payload = await response.json();
  // Carries status + code so screens show a translated line (useErrorMessage) instead of the English `detail`.
  if (!response.ok) throw new ApiError(response.status, typeof payload.detail === 'string' ? payload.detail : 'Search is unavailable. Please try again.', typeof payload.code === 'string' ? payload.code : undefined); // i18n-ignore (English fallback behind the code mapping)
  return payload;
}
