import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
// From the runtime file, not the '@/src/i18n' index: the index mounts ProfileLanguageSync, which imports this file (a cycle).
import { t } from '@/src/i18n/runtime';

export type PaymentMethod = 'cod' | 'upi' | 'card' | 'netbanking' | 'wallet' | 'paylater';
// The UPI app picked on the Payment Options screen ('id' = pay with a UPI ID instead of an app).
export type UpiApp = 'google_pay' | 'phonepe' | 'paytm' | 'bhim' | 'whatsapp' | 'id';
export type Address = {
  id: string; label: string; name: string; phone: string; line: string; area: string; pin: string;
  // Added with the map flow; older saved addresses do not have them.
  kind?: 'home' | 'work' | 'other'; lat?: number; lng?: number; building?: string; street?: string;
  locality?: string; formatted?: string; instructions?: string;
};
export type Diet = '' | 'veg' | 'egg' | 'nonveg';
export type Language = 'en' | 'mr' | 'hi';
export type Profile = {
  name: string; email: string; phone: string; avatar: string;
  // Added with the profile overhaul; older saved profiles get the defaults below.
  photo: string;                 // data URI of a chosen photo, or '' for the avatar icon
  birthday: string;              // DD/MM, optional — for a birthday treat later
  diet: Diet;                    // shapes food suggestions ('' = no preference)
  language: Language;            // Marathi/Hindi are coming soon
  notifications: { orders: boolean; offers: boolean; bookings: boolean };
};
// payment + upiApp = the last way this customer paid; checkout offers it first next time.
type CustomerData = { profile: Profile; addresses: Address[]; payment: PaymentMethod; upiApp?: UpiApp; referral: string };
const KEY = 'onecity.customer.v1';
const SAVED_KEY = 'onecity.saved-products.v1';
// "Offers near me" is marketing, so it starts off: under the DPDP Act consent must be a clear
// yes, never a pre-ticked box (docs/DPDP.md). Order and booking updates are part of the service.
const defaults: CustomerData = {
  profile: { name: '', email: '', phone: '', avatar: 'person', photo: '', birthday: '', diet: '', language: 'en', notifications: { orders: true, offers: false, bookings: true } },
  addresses: [], payment: 'cod', referral: '',
};
const newReferral = () => `ONE${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
type Context = CustomerData & { ready: boolean; saved: string[]; error: string; clearError: () => void; update: (patch: Partial<CustomerData>) => Promise<void>; toggleSaved: (id: string) => Promise<void>; reset: () => Promise<void> };
const CustomerContext = createContext<Context | null>(null);
// The wishlist on its own, so product cards redraw when it changes and not on every profile edit.
type SavedContextValue = { saved: string[]; ready: boolean; toggleSaved: (id: string) => Promise<void> };
const SavedContext = createContext<SavedContextValue | null>(null);
export function CustomerProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<CustomerData>(defaults); const [saved, setSaved] = useState<string[]>([]);
  const [ready, setReady] = useState(false); const [error, setError] = useState('');
  const current = useRef(defaults); const currentSaved = useRef<string[]>([]); const queue = useRef(Promise.resolve());
  useEffect(() => { (async () => {
    try {
      const [stored, favourites] = await Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(SAVED_KEY)]);
      const parsed = stored ? JSON.parse(stored) : {};
      const next = { ...defaults, ...parsed, profile: { ...defaults.profile, ...parsed.profile }, referral: parsed.referral || newReferral() };
      const ids = favourites ? JSON.parse(favourites) : [];
      current.current = next; currentSaved.current = Array.isArray(ids) ? ids.filter(x => typeof x === 'string') : [];
      setData(next); setSaved(currentSaved.current); await AsyncStorage.setItem(KEY, JSON.stringify(next));
    } catch { setError(t('account.storageLoadError')); }
    finally { setReady(true); }
  })(); }, []);
  const enqueue = (action: () => Promise<void>) => {
    const result = queue.current.catch(() => {}).then(action);
    queue.current = result.catch(() => { setError(t('account.storageSaveError')); });
    return result;
  };
  const update = (patch: Partial<CustomerData>) => enqueue(async () => {
    if (!ready) throw new Error(t('account.profileLoading'));
    const next = { ...current.current, ...patch };
    await AsyncStorage.setItem(KEY, JSON.stringify(next)); current.current = next; setData(next); setError('');
  });
  const toggleSaved = (id: string) => enqueue(async () => {
    if (!ready) return;
    const next = currentSaved.current.includes(id) ? currentSaved.current.filter(x => x !== id) : [...currentSaved.current, id];
    await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next)); currentSaved.current = next; setSaved(next); setError('');
  });
  // Privacy & your data → "Clear this phone" / "Delete my account": forget the profile, addresses
  // and wishlist here too, not only in storage (src/privacy.ts clearPhone removes the stored copies).
  const reset = () => enqueue(async () => {
    const next = { ...defaults, referral: newReferral() };
    await AsyncStorage.multiRemove([KEY, SAVED_KEY]);
    current.current = next; currentSaved.current = []; setData(next); setSaved([]); setError('');
  });
  const latestToggle = useRef(toggleSaved); useLayoutEffect(() => { latestToggle.current = toggleSaved; });
  const stableToggle = useCallback((id: string) => latestToggle.current(id), []);
  const savedValue = useMemo(() => ({ saved, ready, toggleSaved: stableToggle }), [saved, ready, stableToggle]);
  return <SavedContext.Provider value={savedValue}><CustomerContext.Provider value={{ ...data, ready, saved, error, clearError: () => setError(''), update, toggleSaved, reset }}>{children}</CustomerContext.Provider></SavedContext.Provider>;
}
export function useSavedProducts() { const value = useContext(SavedContext); if (!value) throw new Error('CustomerProvider missing'); return value; } // i18n-ignore: developer error
export function useCustomer() { const value = useContext(CustomerContext); if (!value) throw new Error('CustomerProvider missing'); return value; } // i18n-ignore: developer error