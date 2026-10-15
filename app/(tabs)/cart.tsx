// The cart. Two carts share this screen (src/cart.tsx): Food (one restaurant) and Shopping (any
// stores, shown grouped by store and split by the server into one order per store). When both have
// items a switch at the top picks which one to pay for; they are paid separately.
// Pay needs, in this order: where to deliver (the address row at the top), a signed-in customer
// (sign-in opens and then brings them back here to carry on paying), and how to pay. Browsing and
// filling the cart never need an account.
import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useIsFocused, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { haptic } from "@/src/haptics";
import { RollingNumber } from "@/src/components/motion/rolling-number";
import { SlideToConfirm } from "@/src/components/motion/slide-to-confirm";
import { colors, radius, spacing } from "@/src/theme";
import { CartKind, useCart } from "@/src/cart";
import { apiGet, apiPost, Bill, Checkout, Coupon, CouponResult, PaymentResult, PaymentStart, randomId } from "@/src/api";
import { VendorNote } from '@/src/components/vendor-note';
import { OneSaver } from '@/src/components/one-saver';
import { CheckoutPayment } from '@/src/components/checkout-payment';
import { PaymentChoice, PaymentSheet } from '@/src/components/payment-sheet';
import { RazorpayCheckout } from '@/src/components/razorpay-checkout';
import { PaymentMethodsSheet, useMethodLabel } from '@/src/components/payment-methods';
import { isPayBrand, PayLogo } from '@/src/components/pay-logo';
import { PaymentProgress } from '@/src/components/payment-progress';
import { clearInFlight, readInFlight, readLastUsed, saveLastUsed, startOrder, switchToCash, usePaymentMethods, type CashfreeStart, type InFlight } from '@/src/payments/api';
import { defaultRow, defaultUpi, normalizePhone, orderMethods, orderPick, toLastUsed, type LastUsed, type PayPick } from '@/src/payments/logic';
import { paymentLabel } from '@/src/components/payment-options';
import { useFeatures } from '@/src/features';
import { useCustomer } from '@/src/customer';
import { useDeliveryLocation } from '@/src/delivery-location';
import { addressText } from '@/src/places';
import { accessToken, supabase } from '@/src/lib/supabase';
import { scheduleOrderJourney } from '@/src/native/ios-extras';
import { CornerGlow } from '@/src/components/corner-glow';
import { OneLottie } from '@/src/components/one-lottie';
import { errorKey, useErrorMessage, useFormat, useTranslation } from '@/src/i18n';

// Pay tapped while signed out: kept outside the screen (so it survives the screen being rebuilt)
// until the customer is back from sign-in, then paid with automatically.
let payAfterSignIn: PaymentChoice | null = null;

type FailureFallback = 'cart.bill.error' | 'checkout.error.place' | 'checkout.error.confirm';

export default function CartScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const fmt = useFormat();
  const message = useErrorMessage();
  const english = (i18n.resolvedLanguage ?? i18n.language ?? 'en') === 'en'; // server-written sentences are English only
  const focused = useIsFocused();
  const { carts, kind, setKind, add, remove, clear } = useCart();
  const items = carts[kind];
  const other: CartKind = kind === 'food' ? 'shopping' : 'food';
  const both = carts.food.length > 0 && carts.shopping.length > 0;
  // An emptied cart gives way to the other one when that has items.
  useEffect(() => { if (!items.length && carts[other].length) setKind(other); }, [items.length, carts, other, setKind]);
  const totalItems = items.reduce((n, i) => n + i.qty, 0);
  const totalPrice = items.reduce((n, i) => n + i.qty * i.price, 0);
  const { payment, upiApp, profile, update, addresses } = useCustomer();
  const { online_payments } = useFeatures();
  // With online payments off, everything below the `online` checks is skipped and checkout is
  // cash on delivery exactly as before.
  const choice: PaymentChoice = { method: online_payments ? payment : 'cod', app: upiApp };
  const [sheet, setSheet] = useState(false);
  type Attempt = { start: PaymentStart; choice: PaymentChoice; basket: string; kind: CartKind };
  const [session, setSession] = useState<Attempt | null>(null);  // Razorpay Checkout is open
  const [unpaid, setUnpaid] = useState<Attempt | null>(null);    // the last online attempt did not go through

  // Where to deliver: the place chosen in the header (useDeliveryLocation). "Home: 12 MG Road, …"
  // splits into its label and address; a saved address also brings its delivery instructions.
  const { location, point, edit } = useDeliveryLocation();
  // (The second form is how the older Saved Addresses screen writes the header line.)
  const saved = addresses.find(a => addressText(a) === location || `${a.label}: ${a.line}, ${a.area}, ${a.pin}` === location);
  const cut = location.indexOf(': ');
  const label = saved?.label ?? (cut > 0 && cut <= 40 ? location.slice(0, cut) : '');
  const addressLine = cut > 0 && cut <= 40 ? location.slice(cut + 2) : location;
  // Paying needs a door-level address, i.e. a saved one. A town picked at first launch or "Current
  // location" is enough to browse, but not for a rider to find the door.
  const hasAddress = !!saved;
  const [notes, setNotes] = useState('');
  useEffect(() => { setNotes(saved?.instructions ?? ''); }, [location]); // eslint-disable-line react-hooks/exhaustive-deps
  const [needAddress, setNeedAddress] = useState(false);
  useEffect(() => { if (hasAddress) setNeedAddress(false); }, [hasAddress]);

  const [couponCode, setCouponCode] = useState("");
  const [applied, setApplied] = useState<Coupon | null>(null);
  // The server's own sentence is English only, so it is shown as-is in English and replaced by the catalogue line elsewhere.
  const [couponMsg, setCouponMsg] = useState<{ ok: boolean; server?: string; fallback: 'applied' | 'invalid' | 'failed' } | null>(null);
  const [placing, setPlacing] = useState(false);
  const checkoutKey = useRef<string | null>(null);
  const [applying, setApplying] = useState(false);
  // Errors are kept as the error itself and worded while rendering, so they follow the language.
  const [checkoutError, setCheckoutError] = useState<{ error: unknown; fallback: FailureFallback } | null>(null);
  const [tab, setTab] = useState<'cart' | 'saver'>('cart');
  const [showTaxes, setShowTaxes] = useState(false);

  // Every number on this screen comes from the server's bill, so the cart can never show a total
  // that checkout would then refuse. Re-quoted (debounced) whenever the cart or coupon changes.
  const [bill, setBill] = useState<Bill | null>(null);
  const [billError, setBillError] = useState<{ error: unknown } | null>(null);
  useEffect(() => { setBill(null); setBillError(null); }, [kind]);
  const cartKey = `${kind}:${items.map(i => `${i.id}x${i.qty}`).join(',')}`;
  useEffect(() => {
    if (!items.length) { setBill(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      apiPost<Bill>('/cart/quote', { items: items.map(i => ({ id: i.id, qty: i.qty })), coupon_code: applied?.code ?? null })
        .then(b => { if (live) { setBill(b); setBillError(null); } })
        .catch(e => { if (live) setBillError({ error: e }); });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey, applied?.code]);
  // A changed cart or address is a new checkout: the old attempt is forgotten (an unpaid one never
  // becomes an order).
  const basket = `${cartKey}|${applied?.code ?? ''}|${location}|${point ? `${point.lat},${point.lng}` : ''}|${notes.trim()}`;
  const checkoutFor = useRef(basket);
  const failed = unpaid?.basket === basket ? unpaid : null;
  const couponDiscount = bill?.discount ?? 0;
  const deliveryFee = bill?.delivery_fee ?? 0;
  const grand = bill?.total ?? totalPrice;

  // Cashfree (docs/PAYMENTS.md "App API (Cashfree)"): its own method list, progress screen and refund line.
  // Razorpay (or a method list that cannot be read) keeps the older sheet and flow above.
  const cfMethods = usePaymentMethods(grand, online_payments && !!bill);
  const legacyOnline = online_payments && (cfMethods.data?.provider === 'razorpay' || cfMethods.isError);
  const cfMode = online_payments && !legacyOnline;
  const [lastUsed, setLastUsed] = useState<LastUsed | null>(null);
  useEffect(() => { void readLastUsed().then(setLastUsed); }, []);
  const cfRows = useMemo(() => orderMethods(cfMethods.data, lastUsed), [cfMethods.data, lastUsed]);
  const methodLabel = useMethodLabel();
  // The one-tap choice in the footer: last-used method (or the first that works), with its UPI way.
  const quickPick = (): PayPick | null => {
    const id = defaultRow(cfRows);
    if (!id || !cfMethods.data) return null;
    if (id !== 'upi') return { method: id, phone: normalizePhone(profile.phone) };
    const u = defaultUpi(cfMethods.data, Platform.OS === 'web' ? 'web' : 'native', lastUsed);
    return { method: 'upi', mode: u.mode, app: u.app, phone: normalizePhone(profile.phone) };
  };
  const quick = cfMode ? quickPick() : null;
  const quickLabel = quick ? methodLabel(quick.method, quick.mode === 'intent' ? quick.app : undefined) : '';
  // The chosen UPI app's own logo next to its name on the PAY USING line.
  const payApp = cfMode ? (quick?.method === 'upi' && quick.mode === 'intent' ? quick.app : undefined) : choice.method === 'upi' ? choice.app : undefined;
  type CfFlow = { start: CashfreeStart; pick: PayPick; kind: CartKind; resume?: boolean; startedAt?: number };
  const [cfFlow, setCfFlow] = useState<CfFlow | null>(null);        // a Cashfree payment is open
  const [cfWaiting, setCfWaiting] = useState<InFlight | null>(null); // one that was left open (app closed, "back to cart")
  const cfLast = useRef<{ checkout_id: string; basket: string; kind: CartKind } | null>(null);
  const resumeFlow = (m: InFlight, auto?: boolean) => {
    setCfWaiting(null);
    setCfFlow({ start: { provider: 'cashfree', checkout_id: m.checkout_id, order_id: m.order_id, order_ids: [], payment_status: 'pending', amount: 0, amount_rupees: 0, currency: 'INR', poll: m.poll }, pick: { method: 'upi' }, kind: m.kind, resume: true, startedAt: auto ? m.started : m.started });
  };
  // A payment that was open when the app closed (or a payment page sent the customer back here): ask the server about it.
  useEffect(() => {
    if (!cfMode || !focused) return;
    void readInFlight().then(m => { if (m && !cfFlow) resumeFlow(m, true); });
    // Once per visit to the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfMode, focused]);
  // The sentence for a failed call. A coded server failure ('outside_delivery_area', 'merchant_unavailable'…) always
  // gets its translated sentence. Without a code, English still shows the server's own line (never an 'API …'
  // developer line); another language shows the translated status line if the failure has a known HTTP status or
  // network failure, else the specific fallback for this step.
  const failureText = (e: unknown, fallback: FailureFallback) => {
    if (errorKey({ code: (e as { code?: unknown } | null)?.code }) !== 'errors.generic') return message(e);
    if (e instanceof Error && !e.message.startsWith('API ')) {
      if (english) return e.message;
      return errorKey(e) !== 'errors.generic' ? message(e) : t(fallback);
    }
    return t(fallback);
  };

  // The cart's items by store, in cart order; each store's own bill joins in once the quote is back.
  const groups = useMemo(() => [...new Set(items.map(i => i.store_id ?? ''))].map(id => ({
    id, items: items.filter(i => (i.store_id ?? '') === id), bill: bill?.groups?.find(g => g.store_id === id),
  })), [items, bill]);

  const runCoupon = async (code: string) => {
    if (!code.trim() || applying) return;
    setApplying(true);
    try {
      const res = await apiPost<CouponResult>("/coupons/apply", { code, subtotal: totalPrice });
      if (res.ok && res.coupon) {
        setApplied(res.coupon);
        setCouponCode(code);
        setTab('cart');
        setCouponMsg({ ok: true, server: res.message, fallback: 'applied' });
        haptic.success();
      } else {
        setApplied(null);
        setCouponMsg({ ok: false, server: res.message || undefined, fallback: 'invalid' });
        haptic.warning();
      }
    } catch {
      setCouponMsg({ ok: false, fallback: 'failed' });
    } finally {
      setApplying(false);
    }
  };
  const applyCoupon = () => runCoupon(couponCode);

  const removeCoupon = () => {
    setApplied(null);
    setCouponCode("");
    setCouponMsg(null);
  };

  const orderBody = (method: string) => ({
    items: items.map((i) => ({
      id: i.id, name: i.name, weight: i.weight, price: i.price, mrp: i.mrp, image: i.image, qty: i.qty,
    })),
    subtotal: bill?.item_total ?? totalPrice,
    discount: couponDiscount,
    delivery_fee: deliveryFee,
    total: grand,
    coupon_code: couponDiscount > 0 ? applied?.code ?? null : null,
    payment_method: method,
    address: { label, text: addressLine, lat: point?.lat ?? null, lng: point?.lng ?? null, notes: notes.trim() },
  });
  // Paid (or placed): that cart empties and the first store order opens (it lists the others).
  const done = (orderId: string, paid: CartKind, placedAt = Date.now()) => {
    checkoutKey.current = null;
    setUnpaid(null);
    // Order updates as notifications (asks permission here, in context). No-op on the web.
    void scheduleOrderJourney(orderId, placedAt);
    clear(paid);
    setApplied(null);
    setCouponCode("");
    setCouponMsg(null);
    router.replace(`/order/${orderId}` as any);
  };
  const say = (error: unknown, fallback: FailureFallback) => setCheckoutError({ error, fallback });

  const handleCheckout = async (pick: PaymentChoice = choice, cfPick?: PayPick) => {
    if (placing || items.length === 0 || !bill) return;
    setCheckoutError(null);
    // 1. Where to deliver.
    if (!hasAddress) { setSheet(false); setNeedAddress(true); haptic.warning(); return; }
    // 2. A signed-in customer (when this build has sign-in at all). The cart stays saved on the
    //    phone; once they are back from sign-in this screen carries on paying by itself.
    if (supabase && !(await accessToken())) { payAfterSignIn = pick; setSheet(false); router.push('/sign-in?next=checkout' as never); return; }
    setPlacing(true);
    try {
      haptic.commit(); // the order is on its way to being placed; success lands when it is confirmed
      // Remember the way they paid, so it is the Preferred Payment next time.
      if (online_payments && (pick.method !== payment || pick.app !== upiApp)) void update({ payment: pick.method, upiApp: pick.app }).catch(() => {});
      setSheet(false);
      // One key per checkout attempt: a retry or double-tap returns the same checkout.
      if (checkoutFor.current !== basket) { checkoutKey.current = null; checkoutFor.current = basket; }
      checkoutKey.current ??= randomId(16);
      if (cfPick && cfPick.method !== 'cod') {
        // Cashfree: the server saves the checkout as unpaid and opens one Cashfree order for its own total. Same key + same basket = same checkout.
        const online = orderPick(cfPick);
        const start = await startOrder({
          ...orderBody(online.payment_method), upi_app: online.upi_app,
          prefill: { name: profile.name, email: profile.email, contact: cfPick.phone || normalizePhone(profile.phone) },
        }, checkoutKey.current);
        if (start.payment_status === 'paid') { void clearInFlight(); return done(start.order_id, kind); }
        cfLast.current = { checkout_id: start.checkout_id, basket, kind };
        const last = toLastUsed(cfPick); setLastUsed(last); void saveLastUsed(last);
        setCfFlow({ start, pick: cfPick, kind });
        return;
      }
      if (cfPick && cfLast.current?.basket === basket) {
        // Cash after an online try that did not go through: the same checkout becomes cash on delivery.
        const r = await switchToCash(cfLast.current.checkout_id);
        void saveLastUsed({ method: 'cod' }); cfLast.current = null; void clearInFlight();
        return done(r.order_id, kind);
      }
      if (cfPick) { const last: LastUsed = { method: 'cod' }; setLastUsed(last); void saveLastUsed(last); }
      if (online_payments && !cfPick && pick.method !== 'cod') {
        // Online: the server saves the checkout as unpaid and opens one Razorpay order for its own total.
        const start = await apiPost<PaymentStart>('/payments/order', {
          ...orderBody(pick.method), upi_app: pick.method === 'upi' ? pick.app ?? null : null,
          prefill: { name: profile.name, email: profile.email, contact: profile.phone },
        }, { "Idempotency-Key": checkoutKey.current });
        if (start.payment_status === 'paid') return done(start.order_id, kind);
        setUnpaid(null);
        setSession({ start, choice: pick, basket, kind });
        return;
      }
      if (online_payments && !cfPick && failed) {
        // "Choose another way to pay" after a failed attempt: the same checkout becomes cash on delivery.
        const r = await apiPost<{ order_id: string }>('/payments/cod', { checkout_id: failed.start.checkout_id });
        return done(r.order_id, failed.kind);
      }
      const checkout = await apiPost<Checkout>("/checkouts", orderBody(cfPick ? 'cod' : payment), { "Idempotency-Key": checkoutKey.current });
      done(checkout.orders[0].id, kind, new Date(checkout.created_at).getTime());
    } catch (e) {
      say(e, 'checkout.error.place');
    } finally {
      setPlacing(false);
    }
  };

  // Back from sign-in: carry on paying with what they picked — only on this visit to the screen, and
  // only if they did sign in. The latest handleCheckout is used, so it sees the bill as it is now.
  const pay = useRef(handleCheckout); pay.current = handleCheckout;
  const resume = useRef<PaymentChoice | null>(null);
  useEffect(() => {
    if (!focused) { resume.current = null; return; }
    if (payAfterSignIn) { resume.current = payAfterSignIn; payAfterSignIn = null; }
  }, [focused]);
  useEffect(() => {
    const pick = resume.current;
    if (!focused || !pick || !bill) return;
    resume.current = null;
    void accessToken().then(token => { if (token) void pay.current(pick); });
  }, [focused, bill]);

  // Razorpay answered. Success is only trusted after the server checks Razorpay's signature.
  const onPaymentResult = async (result: PaymentResult) => {
    const current = session;
    setSession(null);
    if (!current) return;
    setPlacing(true);
    setCheckoutError(null);
    try {
      if (result.type === 'success') {
        await apiPost('/payments/verify', { checkout_id: current.start.checkout_id, ...result });
        return done(current.start.order_id, current.kind);
      }
      // Closed or failed — but a slow UPI payment may still have landed (the webhook marks it paid).
      const checkout = await apiGet<Checkout>(`/checkouts/${current.start.checkout_id}`).catch(() => null);
      if (checkout?.payment_status === 'paid') return done(current.start.order_id, current.kind);
      setUnpaid(current);
    } catch (e) {
      say(e, 'checkout.error.confirm');
    } finally {
      setPlacing(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} testID="cart-screen">
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.cartTop}><Pressable testID="cart-back" accessibilityLabel={t('common.goBack')} style={styles.back} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}><Icon name="chevron-back" size={20} color={colors.onSurface} /></Pressable><Text testID="cart-title" style={styles.title}>{t('cart.title')}</Text><Text testID="cart-total-items" style={styles.subtitle}>{t('cart.itemCount', { count: totalItems })}</Text></View>
        {both && <>
          <View testID="cart-kinds" accessibilityRole="tablist" style={styles.kinds}>
            {(['food', 'shopping'] as const).map(k => <Pressable key={k} testID={`cart-kind-${k}`} accessibilityRole="tab" accessibilityState={{ selected: kind === k }} onPress={() => { if (kind !== k) haptic.select(); setKind(k); }} style={[styles.kind, kind === k && styles.kindOn]}>
              <Icon name={k === 'food' ? 'restaurant-outline' : 'bag-handle-outline'} size={15} color={kind === k ? colors.surface : colors.forest} />
              <Text style={[styles.kindText, kind === k && styles.kindTextOn]}>{t(k === 'food' ? 'cart.kindTab.food' : 'cart.kindTab.shopping', { n: fmt.number(carts[k].reduce((n, i) => n + i.qty, 0)) })}</Text>
            </Pressable>)}
          </View>
          <Text style={styles.kindNote}>{t('cart.kindNote')}</Text>
        </>}
        <View testID="cart-tabs" style={styles.tabs}>{([{ id: 'cart', label: 'cart.tab.cart', icon: 'bag-handle-outline' }, { id: 'saver', label: 'cart.tab.saver', icon: 'sparkles-outline' }] as const).map(tb => <Pressable key={tb.id} testID={`cart-tab-${tb.id}`} accessibilityRole="tab" accessibilityState={{ selected: tab === tb.id }} onPress={() => { if (tab !== tb.id) haptic.select(); setTab(tb.id); }} style={[styles.tab, tab === tb.id && styles.selectedTab]}><Icon name={tb.icon as any} size={15} color={tab === tb.id ? colors.surface : colors.forest} /><Text style={[styles.tabText, tab === tb.id && styles.selectedTabText]}>{t(tb.label)}</Text></Pressable>)}</View>
      </View>

      {tab === 'saver' ? <OneSaver onApply={code => void runCoupon(code)} applying={applying} /> : items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Icon name="bag-handle-outline" size={64} color={colors.forest} />
          <Text style={styles.emptyTitle}>{t('cart.empty.title')}</Text>
          <Text style={styles.emptySub}>{t('cart.empty.sub')}</Text>
          <TouchableOpacity style={styles.browseBtn} onPress={() => router.replace("/(tabs)" as any)} testID="browse-btn">
            <Text style={styles.browseText}>{t('cart.empty.browse')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView testID="cart-scroll" style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, paddingBottom: 24 }}>
            {/* Where it goes: tap to change (the location screen) */}
            <Pressable testID="cart-address" accessibilityRole="button" accessibilityLabel={hasAddress ? t('cart.address.a11y', { label: label || '', address: addressLine }) : t('cart.address.a11yChoose')} onPress={edit} style={[styles.deliveryCard, needAddress && styles.deliveryCardAsk]}>
              <Icon name={hasAddress ? 'location' : 'location-outline'} size={22} color={colors.onSurface} />
              <View style={{ flex: 1 }}>
                {hasAddress
                  ? <Text testID="cart-delivery-title" style={styles.deliverySub} numberOfLines={3}><Text style={styles.deliveryTitle}>{label ? t('cart.address.deliverToLabel', { label }) : t('cart.address.deliverTo')}</Text> · {addressLine}</Text>
                  : <><Text testID="cart-delivery-title" style={styles.deliveryTitle}>{t('cart.address.whereTitle')}</Text><Text testID="cart-delivery-notice" style={styles.deliverySub}>{point ? t('cart.address.noticeNear', { address: addressLine }) : t('cart.address.notice')}</Text></>}
              </View>
              <Icon name="chevron-down" size={18} color={colors.onSurface} />
            </Pressable>
            <TextInput testID="cart-delivery-notes" value={notes} onChangeText={setNotes} maxLength={300} placeholder={t('cart.address.notesPlaceholder')} placeholderTextColor={colors.muted} style={styles.notes} />

            {/* One card per store (a food cart is one restaurant) */}
            {groups.map((g, index) => {
              const gb = g.bill;
              const id = (name: string) => (index === 0 ? name : `${name}-${g.id}`);
              return <View key={g.id || 'store'} style={[styles.card, { marginBottom: spacing.md }]} testID={`cart-store-${g.id}`}>
                <View style={styles.storeHead}>
                  {!!gb?.store_logo && <Image source={gb.store_logo} style={styles.storeLogo} contentFit="cover" />}
                  <View style={{ flex: 1 }}>
                    <Text testID={id('cart-store-name')} style={styles.storeName} numberOfLines={1}>{gb?.store_name ?? t(kind === 'food' ? 'cart.store.yourRestaurant' : 'cart.store.fallback')}</Text>
                    {!!gb && <Text style={styles.storeMeta}>{gb.delivery_time ? t(gb.delivery_fee === 0 ? 'cart.store.metaTimeFree' : 'cart.store.metaTimeFee', { time: fmt.deliveryTime(gb.delivery_time), fee: fmt.money(gb.delivery_fee) }) : t(gb.delivery_fee === 0 ? 'cart.store.metaFree' : 'cart.store.metaFee', { fee: fmt.money(gb.delivery_fee) })}</Text>}
                  </View>
                  {!!gb && groups.length > 1 && <Text testID={id('cart-store-subtotal')} style={styles.storeSubtotal}>{fmt.money(gb.item_total)}</Text>}
                </View>
                {g.items.map((it) => (
                  <View key={it.id} style={styles.row}>
                    <Image source={it.image} style={styles.itemImg} contentFit="cover" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName} numberOfLines={2}>{it.name}</Text>
                      <Text style={styles.itemWeight}>{it.weight}</Text>
                      <Text style={styles.itemPrice}>{fmt.money(it.price)}</Text>
                    </View>
                    <View style={styles.stepper}>
                      <TouchableOpacity onPress={() => { haptic.remove(); remove(it.id); }} style={styles.stepBtn} testID={`cart-dec-${it.id}`}>
                        <Text style={styles.stepText}>−</Text>
                      </TouchableOpacity>
                      <RollingNumber value={it.qty} text={String(it.qty)} lineHeight={20} style={styles.stepQty} />
                      <TouchableOpacity onPress={() => { haptic.add(); add(it); }} style={styles.stepBtn} testID={`cart-inc-${it.id}`}>
                        <Text style={styles.stepText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                {!!gb && gb.amount_to_free_delivery > 0 && (
                  <View style={styles.topUp} testID={id('free-delivery-hint')}>
                    <View style={styles.topUpHead}>
                      <View style={styles.topUpIcon}><Icon name="rocket" size={16} color="#050605" /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.topUpTitle}>{groups.length > 1 ? t('cart.topUp.awayStore', { amount: fmt.money(gb.amount_to_free_delivery), store: gb.store_name }) : t('cart.topUp.away', { amount: fmt.money(gb.amount_to_free_delivery) })}</Text>
                        <Text style={styles.topUpSub}>{gb.top_ups.length ? t('cart.topUp.smart') : t('cart.topUp.freeAbove', { amount: fmt.money(bill?.free_delivery_from ?? 199) })}</Text>
                      </View>
                    </View>
                    {gb.top_ups.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topUpRail} testID={id('smart-top-up')}>
                      {gb.top_ups.map(p => <View key={p.id} style={styles.topUpCard} testID={`top-up-${p.id}`}>
                        <Image source={p.image} style={styles.topUpImg} contentFit="cover" />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.topUpName} numberOfLines={1}>{p.name}</Text>
                          <Text style={styles.topUpPrice}>{fmt.money(p.price)} <Text style={styles.topUpNet}>{t('cart.topUp.net', { amount: fmt.money(p.net) })}</Text></Text>
                        </View>
                        <Pressable testID={`top-up-add-${p.id}`} accessibilityLabel={t('cart.topUp.addA11y', { name: p.name, price: fmt.money(p.price) })} onPress={() => { add(p); haptic.add(); }} style={styles.topUpAdd}><Icon name="add" size={18} color={colors.electricLime} /></Pressable>
                      </View>)}
                    </ScrollView>}
                  </View>
                )}
                {!!gb && gb.amount_to_free_delivery === 0 && gb.delivery_fee === 0 && (
                  <View style={styles.freeHint} testID={id('free-delivery-unlocked')}>
                    <Icon name="checkmark-circle" size={18} color={colors.onSuccess} />
                    <Text style={styles.freeHintText}>{t('cart.freeUnlocked', { amount: fmt.money(gb.delivery_fee_before_waiver) })}</Text>
                  </View>
                )}
              </View>;
            })}

            {/* Coupon */}
            <View style={styles.card}>
              <View style={styles.couponHead}>
                <Icon name="pricetag-outline" size={18} color={colors.onSurface} />
                <Text style={styles.billTitle}>{t('cart.coupon.title')}</Text>
              </View>
              {applied ? (
                <View style={styles.appliedRow} testID="applied-coupon">
                  <View style={styles.appliedPill}>
                    <Icon name="checkmark-circle" size={16} color={colors.onSuccess} />
                    <Text style={styles.appliedText}>{applied.code} · {applied.label}</Text>
                  </View>
                  <TouchableOpacity onPress={removeCoupon} testID="remove-coupon">
                    <Text style={styles.removeCoupon}>{t('cart.coupon.remove')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.couponRow}>
                  <TextInput
                    value={couponCode}
                    onChangeText={setCouponCode}
                    placeholder={t('cart.coupon.placeholder')}
                    placeholderTextColor={colors.muted}
                    autoCapitalize="characters"
                    onSubmitEditing={applyCoupon}
                    returnKeyType="done"
                    style={styles.couponInput}
                    testID="coupon-input"
                  />
                  <TouchableOpacity style={styles.applyBtn} onPress={applyCoupon} disabled={applying} testID="apply-coupon-btn">
                    <Text style={styles.applyText}>{applying ? t('cart.coupon.applying') : t('cart.coupon.apply')}</Text>
                  </TouchableOpacity>
                </View>
              )}
              {couponMsg && (
                <Text style={[styles.couponMsg, { color: couponMsg.ok ? colors.onSuccess : colors.onError }]} testID="coupon-msg">
                  {english && couponMsg.server ? couponMsg.server : t(`cart.coupon.${couponMsg.fallback}`)}
                </Text>
              )}
              {applied && totalPrice < applied.min_order && <Text testID="coupon-minimum-warning" style={styles.couponMsg}>{t('cart.coupon.addMore', { amount: fmt.money(applied.min_order - totalPrice) })}</Text>}
              {applied && totalPrice >= applied.min_order && bill?.coupon && !bill.coupon.ok && <Text testID="coupon-not-usable" style={[styles.couponMsg, { color: colors.onError }]}>{english && bill.coupon.message ? bill.coupon.message : t('cart.coupon.notUsable')}</Text>}
              <View style={{ marginTop: spacing.sm, gap: 6 }}>
                <TouchableOpacity testID="coupon-suggestion-latur10" onPress={() => setCouponCode("LATUR10")}>
                  <Text style={styles.hint}>{t('cart.coupon.suggestLatur10', { min: fmt.money(99) })}</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="coupon-suggestion-fresh50" onPress={() => setCouponCode("FRESH50")}>
                  <Text style={styles.hint}>{t('cart.coupon.suggestFresh50', { off: fmt.money(50), min: fmt.money(199) })}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {!online_payments && <CheckoutPayment />}
            {/* Bill details — straight from the server's quote (server/pricing.ts) */}
            <View style={[styles.card, { marginTop: spacing.md, overflow: 'hidden' }]} testID="bill-details">
              <CornerGlow color={colors.lime} corner="top-right" size={240} strength={0.2} />
              <Text style={styles.billTitle}>{t('cart.bill.title')}</Text>
              {!bill ? (
                billError ? <Text testID="bill-error" style={[styles.couponMsg, { color: colors.onError }]}>{failureText(billError.error, 'cart.bill.error')}</Text>
                  : <OneLottie testID="bill-loading" name="neon-loader" size={56} loop style={{ alignSelf: 'center' }} />
              ) : <>
                <BillRow testID="bill-items" label={t('cart.bill.itemTotal')} value={fmt.money(bill.item_total)} was={bill.mrp_savings > 0 ? fmt.money(bill.item_mrp_total) : undefined} />
                {bill.groups.length > 1
                  ? <BillRow testID="bill-delivery" label={t('cart.bill.deliveryStores', { n: fmt.number(bill.groups.length) })} value={bill.delivery_fee === 0 ? t('cart.bill.free') : fmt.money(bill.delivery_fee)} success={bill.delivery_fee === 0}
                      note={t('cart.bill.eachStore', { stores: bill.groups.map(g => g.delivery_fee ? `${g.store_name} ${fmt.money(g.delivery_fee)}` : t('cart.bill.storeFree', { store: g.store_name })).join(' · ') })} />
                  : <BillRow testID="bill-delivery" label={t('cart.bill.deliveryFee')} value={bill.delivery_fee === 0 ? t('cart.bill.free') : fmt.money(bill.delivery_fee)} was={bill.delivery_fee === 0 ? fmt.money(bill.delivery_fee_before_waiver) : undefined} success={bill.delivery_fee === 0}
                      note={t(bill.delivery_fee === 0 ? 'cart.bill.deliveryNoteWaived' : 'cart.bill.deliveryNote', { amount: fmt.money(bill.free_delivery_from) })} />}
                {bill.handling_fee > 0 && <BillRow testID="bill-handling" label={t('cart.bill.handling')} value={fmt.money(bill.handling_fee)} />}
                {bill.platform_fee > 0 && <BillRow testID="bill-platform" label={t('cart.bill.platform')} value={fmt.money(bill.platform_fee)} />}
                {bill.gst_added.total > 0 && <>
                  <Pressable testID="bill-gst-toggle" accessibilityRole="button" accessibilityState={{ expanded: showTaxes }} onPress={() => setShowTaxes(v => !v)}>
                    <BillRow label={t('cart.bill.gstFood', { rate: fmt.number(bill.gst_added.rate, { maxFractionDigits: 1 }) })} value={fmt.money(bill.gst_added.total)} note={showTaxes ? t('cart.bill.gstHide') : t('cart.bill.gstShow')} />
                  </Pressable>
                  {showTaxes && <View style={styles.taxBox} testID="bill-gst-breakdown">
                    <BillRow small label={t('cart.bill.cgst', { rate: fmt.number(bill.gst_added.rate / 2, { maxFractionDigits: 1 }), amount: fmt.money(bill.gst_added.taxable) })} value={fmt.money(bill.gst_added.cgst)} />
                    <BillRow small label={t('cart.bill.sgst', { rate: fmt.number(bill.gst_added.rate / 2, { maxFractionDigits: 1 }), amount: fmt.money(bill.gst_added.taxable) })} value={fmt.money(bill.gst_added.sgst)} />
                  </View>}
                </>}
                {bill.discount > 0 && <BillRow testID="bill-coupon" label={t('cart.bill.coupon', { code: bill.coupon?.code ?? '' })} value={`− ${fmt.money(bill.discount)}`} success />}
                <View style={styles.divider} />
                <BillRow testID="bill-total" label={t('cart.bill.toPay')} value={fmt.money(bill.total)} strong note={bill.groups.length > 1 ? t('cart.bill.onePayment', { n: fmt.number(bill.groups.length) }) : undefined} />
                {bill.gst_included.length > 0 && <Pressable testID="bill-included-toggle" onPress={() => setShowTaxes(v => !v)} style={{ marginTop: spacing.sm }}>
                  <Text style={styles.hint}>{showTaxes ? t('cart.bill.gstIncludedOpen') : t('cart.bill.gstIncludedClosed')}</Text>
                  {showTaxes && bill.gst_included.map(tx => <BillRow small key={tx.rate} label={t('cart.bill.gstIncludedRow', { rate: fmt.number(tx.rate, { maxFractionDigits: 1 }), half: fmt.number(tx.rate / 2, { maxFractionDigits: 1 }) })} value={fmt.money(tx.cgst + tx.sgst)} />)}
                </Pressable>}
                {bill.total_savings > 0 && (
                  <View style={styles.savings}>
                    <Text testID="cart-order-savings" style={styles.savingsText}>{t('cart.bill.savings', { amount: fmt.money(bill.total_savings) })}</Text>
                  </View>
                )}
              </>}
            </View>
          </ScrollView>

          {!!checkoutError && <Text testID="checkout-error" style={{ color: colors.onError, padding: 12 }}>{failureText(checkoutError.error, checkoutError.fallback)}</Text>}
          {needAddress && <View testID="checkout-need-address" style={styles.ask}>
            <Icon name="location" size={20} color={colors.forest} />
            <View style={{ flex: 1 }}>
              <Text style={styles.askTitle}>{t('cart.address.whereTitle')}</Text>
              <Text style={styles.askText}>{t('cart.address.chooseFirst')}</Text>
            </View>
            <TouchableOpacity testID="checkout-choose-address" onPress={edit} style={styles.askBtn}><Text style={styles.askBtnText}>{t('cart.address.choose')}</Text></TouchableOpacity>
          </View>}
          {!!failed && !placing && <View testID="payment-retry" style={styles.retry}>
            <Icon name="alert-circle" size={20} color={colors.onError} />
            <View style={{ flex: 1 }}>
              <Text style={styles.retryText}>{t('checkout.retry.text')}</Text>
              <View style={styles.retryActions}>
                <TouchableOpacity testID="payment-retry-again" onPress={() => handleCheckout(failed.choice)} style={styles.retryBtn}><Text style={styles.retryBtnText}>{t('common.retry')}</Text></TouchableOpacity>
                <TouchableOpacity testID="payment-retry-other" onPress={() => setSheet(true)} style={[styles.retryBtn, styles.retryBtnGhost]}><Text style={[styles.retryBtnText, { color: colors.forest }]}>{t('checkout.retry.other')}</Text></TouchableOpacity>
              </View>
            </View>
          </View>}
          <VendorNote items={items} />
          {online_payments ? (
            // Online payments live: "PAY USING" opens Payment Options; the big button pays with it.
            <View testID="checkout-footer" style={[styles.payBar, { marginBottom: 12, marginHorizontal: spacing.lg }]}>
              <Pressable testID="checkout-pay-using" accessibilityRole="button" accessibilityLabel={t('checkout.chooseA11y')} onPress={() => setSheet(true)} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}>
                <Text style={styles.payUsing}>{t('checkout.payUsing')} <Icon name="caret-up" size={10} color={colors.muted} /></Text>
                <View style={styles.payMethodLine}>
                  {!!payApp && isPayBrand(payApp) && <PayLogo brand={payApp} height={14} />}
                  <Text testID="checkout-selected-payment" style={styles.payMethod}>{cfMode ? quickLabel : paymentLabel(choice.method, choice.method === 'upi' ? choice.app : undefined)}</Text>
                </View>
              </Pressable>
              <SlideToConfirm style={styles.payNow} testID="checkout-btn" disabled={!bill || !!session || !!cfFlow || (cfMode && !quick)} busy={placing}
                thumbColor={colors.onBrandSecondary} arrowColor={colors.brandSecondary} textStyle={[styles.payNowText, styles.slideText]} hint={t('checkout.slideHint')}
                label={(cfMode ? quick?.method === 'cod' : choice.method === 'cod') ? t('checkout.slideToPlace', { amount: fmt.money(grand) }) : t('checkout.slideToPay', { amount: fmt.money(grand) })}
                tapLabel={(cfMode ? quick?.method === 'cod' : choice.method === 'cod') ? t('checkout.placeOrder', { amount: fmt.money(grand) }) : t('checkout.pay', { amount: fmt.money(grand) })}
                onConfirm={() => {
                  if (!cfMode) return handleCheckout();
                  // One slide pays with the last-used method; if the payment needs more from the customer (a mobile number), the options open instead.
                  if (quick && (quick.method === 'cod' || quick.phone)) return handleCheckout({ method: quick.method, app: quick.app }, quick);
                  setSheet(true);
                }} />
            </View>
          ) : (
            <View testID="checkout-footer" style={[styles.checkoutBar, { marginBottom: 12, marginHorizontal: spacing.lg }]}>
              <View style={{ flex: 1 }}>
                <RollingNumber testID="checkout-total" value={grand} text={fmt.money(grand)} lineHeight={24} style={styles.checkoutTotal} />
                <Text testID="checkout-payment-notice" style={styles.checkoutMeta}>{t('checkout.sampleNotice')}</Text>
              </View>
              <TouchableOpacity style={styles.checkoutBtn} onPress={() => handleCheckout()} testID="checkout-btn" disabled={placing}>
                {placing && <ActivityIndicator color={colors.forest} />}<Text style={styles.checkoutText}>{placing ? t('checkout.placing') : t('checkout.placeSample')}</Text>
                {!placing && <Icon name="arrow-forward" size={16} color={colors.onBrandSecondary} />}
              </TouchableOpacity>
            </View>
          )}
          {!!cfWaiting && !cfFlow && <View testID="pay-pending-banner" style={styles.retry}>
            <Icon name="time-outline" size={20} color={colors.onWarning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.retryText}>{t('payui.pending.title')} {t('payui.pending.body')}</Text>
              <View style={styles.retryActions}>
                <TouchableOpacity testID="pay-pending-check" onPress={() => resumeFlow(cfWaiting)} style={styles.retryBtn}><Text style={styles.retryBtnText}>{t('payui.pending.check')}</Text></TouchableOpacity>
              </View>
            </View>
          </View>}
          {cfMode && sheet && <PaymentMethodsSheet methods={cfMethods.data} loading={cfMethods.isLoading} failed={cfMethods.isError} onReload={() => void cfMethods.refetch()}
            last={lastUsed} total={grand} itemCount={totalItems} savings={bill?.total_savings ?? 0} busy={placing} profilePhone={profile.phone}
            onPay={pick => handleCheckout({ method: pick.method, app: pick.app }, pick)} onClose={() => setSheet(false)} />}
          {!!cfFlow && <PaymentProgress key={cfFlow.start.checkout_id} start={cfFlow.start} pick={cfFlow.pick} kind={cfFlow.kind} total={grand} resume={cfFlow.resume} startedAt={cfFlow.startedAt}
            canCash={!!cfMethods.data?.cod.available}
            onPaid={orderId => { const f = cfFlow; setCfFlow(null); cfLast.current = null; done(orderId, f.kind); }}
            onOther={() => { setCfFlow(null); setSheet(true); }}
            onRetry={() => { const f = cfFlow; setCfFlow(null); void handleCheckout({ method: f.pick.method, app: f.pick.app }, f.pick); }}
            onCash={() => { setCfFlow(null); void handleCheckout({ method: 'cod' }, { method: 'cod' }); }}
            onLeave={() => { setCfFlow(null); void readInFlight().then(setCfWaiting); }} />}
          {online_payments && legacyOnline && sheet && <PaymentSheet onClose={() => setSheet(false)} choice={choice} onPay={pick => handleCheckout(pick)} paying={placing}
            itemCount={totalItems} total={grand} savings={bill?.total_savings ?? 0} />}
          {!!session && <RazorpayCheckout session={session.start} method={session.choice.method} app={session.choice.app} onResult={onPaymentResult} />}
        </>
      )}
    </KeyboardAvoidingView>
  );
}

function BillRow({ label, value, strong, success, was, note, small, testID }: { label: string; value: string; strong?: boolean; success?: boolean; was?: string; note?: string; small?: boolean; testID?: string }) {
  return (
    <View style={billStyles.row} testID={testID}>
      <View style={{ flex: 1 }}>
        <Text style={[billStyles.label, strong && billStyles.strong, small && billStyles.small]}>{label}</Text>
        {!!note && <Text style={billStyles.note}>{note}</Text>}
      </View>
      <View style={billStyles.values}>
        {!!was && <Text style={billStyles.was}>{was}</Text>}
        <Text style={[billStyles.value, strong && billStyles.strong, small && billStyles.small, success && { color: colors.onSuccess }]}>{value}</Text>
      </View>
    </View>
  );
}

const billStyles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: 'flex-start', marginTop: spacing.sm, gap: spacing.md },
  label: { fontSize: 13, color: colors.onSurfaceSecondary },
  note: { fontSize: 11, color: colors.muted, marginTop: 1 },
  values: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  was: { fontSize: 11, color: colors.muted, textDecorationLine: 'line-through' },
  value: { fontSize: 13, color: colors.onSurface, fontWeight: "600" },
  small: { fontSize: 11 },
  strong: { fontWeight: "800", fontSize: 15, color: colors.onSurface },
});

const styles = StyleSheet.create({
  cartTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream }, tabs: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, padding: 4, borderRadius: 28, marginTop: 10 }, tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderRadius: 24 }, selectedTab: { backgroundColor: colors.forestDeep }, tabText: { color: colors.forest, fontSize: 12, fontWeight: '600' }, selectedTabText: { color: colors.surface },
  kinds: { flexDirection: 'row', gap: spacing.sm, marginTop: 10 },
  kind: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.forest },
  kindOn: { backgroundColor: colors.forest },
  kindText: { color: colors.forest, fontSize: 13, fontWeight: '700' },
  kindTextOn: { color: colors.surface },
  kindNote: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 6 },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 20, fontWeight: "700", color: colors.onSurface, flex: 1 },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyEmoji: { fontSize: 64, marginBottom: spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.onSurface },
  emptySub: { fontSize: 13, color: colors.muted, marginTop: 4 },
  browseBtn: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: radius.pill },
  browseText: { color: colors.onBrandPrimary, fontWeight: "700" },
  deliveryCard: { backgroundColor: colors.limeSoft, borderRadius: radius.md, padding: spacing.md, minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.limeSoft },
  deliveryCardAsk: { borderColor: colors.forest },
  deliveryTitle: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  deliverySub: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 2, lineHeight: 19 },
  notes: { minHeight: 44, marginTop: spacing.sm, marginBottom: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface, fontSize: 13 },
  storeHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  storeLogo: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceSecondary },
  storeName: { fontSize: 15, fontWeight: '800', color: colors.onSurface },
  storeMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  storeSubtotal: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  freeHint: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.pastelGreen, padding: spacing.md, borderRadius: radius.md, marginTop: spacing.md },
  topUp: { backgroundColor: '#050605', borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  topUpHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  topUpIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.electricLime, alignItems: 'center', justifyContent: 'center' },
  topUpTitle: { color: colors.surface, fontSize: 14, fontWeight: '800' },
  topUpSub: { color: colors.electricLime, fontSize: 11, fontWeight: '600', marginTop: 2 },
  topUpRail: { gap: 8, marginTop: spacing.md },
  topUpCard: { width: 236, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)' },
  topUpImg: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.surface },
  topUpName: { color: colors.surface, fontSize: 12, fontWeight: '700' },
  topUpPrice: { color: colors.surface, fontSize: 12, fontWeight: '800', marginTop: 2 },
  topUpNet: { color: 'rgba(255,255,255,0.6)', fontWeight: '600', fontSize: 11 },
  topUpAdd: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: colors.electricLime, alignItems: 'center', justifyContent: 'center' },
  freeHintText: { color: colors.onSuccess, fontSize: 13, fontWeight: "700" },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
  row: { flexDirection: "row", gap: spacing.md, alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  itemImg: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
  itemName: { fontSize: 13, fontWeight: "600", color: colors.onSurface },
  itemWeight: { fontSize: 11, color: colors.muted, marginTop: 2 },
  itemPrice: { fontSize: 14, fontWeight: "800", color: colors.onSurface, marginTop: 4 },
  stepper: { flexDirection: "row", alignItems: "center", backgroundColor: colors.brandPrimary, borderRadius: radius.sm, overflow: "hidden" },
  stepBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 14 },
  stepQty: { color: colors.onBrandPrimary, fontWeight: "700", minWidth: 18, textAlign: "center" },
  billTitle: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
  taxBox: { marginTop: 4, marginLeft: spacing.md, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.divider },
  savings: { marginTop: spacing.sm, backgroundColor: colors.pastelGreen, padding: spacing.sm, borderRadius: radius.sm },
  savingsText: { color: colors.onSuccess, fontSize: 12, fontWeight: "700" },
  couponHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  couponRow: { flexDirection: "row", gap: spacing.sm },
  couponInput: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  applyBtn: { paddingHorizontal: 18, minHeight: 48, borderRadius: radius.sm, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  applyText: { color: colors.onBrandPrimary, fontWeight: "800" },
  couponMsg: { marginTop: spacing.sm, fontSize: 12, fontWeight: "700" },
  appliedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.sm, backgroundColor: colors.pastelGreen, borderRadius: radius.sm },
  appliedPill: { flexDirection: "row", alignItems: "center", gap: 6 },
  appliedText: { color: colors.onSuccess, fontWeight: "800", fontSize: 13 },
  removeCoupon: { color: colors.onError, fontWeight: "700", fontSize: 12 },
  hint: { color: colors.muted, fontSize: 11 },
  checkoutBar: { backgroundColor: colors.brandPrimary, borderRadius: radius.lg, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  checkoutTotal: { color: colors.onBrandPrimary, fontSize: 18, fontWeight: "800" },
  checkoutMeta: { color: colors.onSurfaceInverse, fontSize: 8, marginTop: 2 },
  checkoutBtn: { backgroundColor: colors.brandSecondary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  checkoutText: { color: colors.onBrandSecondary, fontWeight: "700", fontSize: 11 },
  payBar: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.sm, paddingLeft: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  payUsing: { fontSize: 10, fontWeight: "800", color: colors.muted, letterSpacing: 0.8 },
  payMethod: { fontSize: 14, fontWeight: "800", color: colors.onSurface, marginTop: 2 },
  payMethodLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  payNow: { flex: 1.3, minHeight: 52, backgroundColor: colors.brandSecondary, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  payNowText: { color: colors.onBrandSecondary, fontWeight: "800", fontSize: 16 },
  slideText: { fontSize: 14 },
  ask: { flexDirection: "row", alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.limeSoft, borderWidth: 1, borderColor: colors.forest },
  askTitle: { color: colors.onSurface, fontSize: 14, fontWeight: '800' },
  askText: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  askBtn: { minHeight: 44, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center' },
  askBtnText: { color: colors.surface, fontWeight: '800', fontSize: 13 },
  retry: { flexDirection: "row", gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.error },
  retryText: { color: colors.onSurface, fontSize: 13, fontWeight: "600", lineHeight: 19 },
  retryActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  retryBtn: { minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.forest, alignItems: "center", justifyContent: "center" },
  retryBtnGhost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.forest },
  retryBtnText: { color: colors.surface, fontWeight: "700", fontSize: 12 },
});
