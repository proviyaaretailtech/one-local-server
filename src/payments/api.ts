// Calls to /api/payments/* for the Cashfree screens. The app only ever holds a short-lived session id and page address;
// money moves on the server. Shapes follow docs/PAYMENTS.md "App API (Cashfree)".
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api';
import { LAST_USED_KEY, parseLastUsed, type LastUsed, type MethodsResponse, type PollInfo, type RefundRow, type StatusAnswer, type UpiAppId } from './logic';

export type CashfreeStart = {
  provider: 'cashfree'; environment?: 'sandbox' | 'production'; checkout_id: string; order_id: string; order_ids: string[];
  payment_status: string; amount: number; amount_rupees: number; currency: 'INR';
  payment_session_id?: string; expires_at?: string; checkout_url?: string; return_url?: string; poll?: PollInfo;
};
export type UpiStart = {
  checkout_id: string; mode: 'intent' | 'qr' | 'collect'; payment_status: string;
  intent?: { links: Partial<Record<UpiAppId | 'default', string>>; url: string | null };
  qr?: { image: string; upi_uri: string };
  collect?: { upi_id_masked: string; expires_at: string; expires_in_s: number };
  poll?: PollInfo;
};

export const fetchMethods = (total: number) => apiGet<MethodsResponse>(`/payments/methods?total=${encodeURIComponent(String(Math.round(total * 100) / 100))}`);
export const startOrder = (body: unknown, idempotencyKey: string) => apiPost<CashfreeStart>('/payments/order', body, { 'Idempotency-Key': idempotencyKey });
export const startUpi = (body: { checkout_id: string; mode: 'intent' | 'qr' | 'collect'; app?: UpiAppId; upi_id?: string }) => apiPost<UpiStart>('/payments/upi', body);
export const fetchStatus = (checkoutId: string) => apiGet<StatusAnswer>(`/payments/status?checkout_id=${encodeURIComponent(checkoutId)}`);
export const switchToCash = (checkoutId: string) => apiPost<{ order_id: string }>('/payments/cod', { checkout_id: checkoutId });
export const fetchRefunds = (q: { checkoutId?: string; orderId?: string }) =>
  apiGet<{ checkout_id: string | null; refunded_total: number; refunds: RefundRow[] }>(`/payments/refund-status?${q.checkoutId ? `checkout_id=${encodeURIComponent(q.checkoutId)}` : `order_id=${encodeURIComponent(q.orderId ?? '')}`}`);

// The method list for this total. Cheap to repeat, so it is refreshed when the total changes.
export function usePaymentMethods(total: number, enabled: boolean) {
  return useQuery({ queryKey: ['pay-methods', Math.round(total * 100)], queryFn: () => fetchMethods(total), enabled: enabled && total > 0, staleTime: 30_000, retry: 1 });
}

export async function readLastUsed(): Promise<LastUsed | null> {
  try { return parseLastUsed(await AsyncStorage.getItem(LAST_USED_KEY)); } catch { return null; }
}
export async function saveLastUsed(v: LastUsed): Promise<void> {
  try { await AsyncStorage.setItem(LAST_USED_KEY, JSON.stringify(v)); } catch { /* the preference is a convenience */ }
}

// A payment in flight, kept on the phone so a closed app, a lost connection or a deep-link return can pick it up again
// by asking the server (the server stays the only source of truth).
export type InFlight = { checkout_id: string; order_id: string; kind: 'food' | 'shopping'; started: number; poll?: PollInfo };
const INFLIGHT_KEY = 'onecity.pay.inflight.v1';
export async function readInFlight(): Promise<InFlight | null> {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(INFLIGHT_KEY)) ?? 'null');
    return v && typeof v.checkout_id === 'string' && Date.now() - (v.started ?? 0) < 6 * 3600_000 ? v : null;
  } catch { return null; }
}
export async function saveInFlight(v: InFlight) { try { await AsyncStorage.setItem(INFLIGHT_KEY, JSON.stringify(v)); } catch { /* best effort */ } }
export async function clearInFlight() { try { await AsyncStorage.removeItem(INFLIGHT_KEY); } catch { /* best effort */ } }
