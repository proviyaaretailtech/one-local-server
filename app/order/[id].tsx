import type { ParseKeys } from 'i18next';
import { useEffect, useState, type ComponentProps } from "react";
import { MAX_APP_WIDTH } from '@/src/layout';
import { View, StyleSheet, ScrollView, TouchableOpacity, Dimensions, ActivityIndicator } from "react-native";
import { Text } from "@/src/ui/text";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing, cancelAnimation } from "react-native-reanimated";
import Svg, { Path, Circle } from "react-native-svg";
import { colors, radius, spacing } from "@/src/theme";
import { api, Checkout, Order } from "@/src/api";
import { VendorNote } from '@/src/components/vendor-note';
import { useMotionAllowed } from '@/src/motion';
import { paymentLabel } from '@/src/components/payment-options';
import { ORDER_TOTAL_S, stageAt, syncOrderActivity, updateOrderWidget } from '@/src/native/ios-extras';
import { OneLottie } from '@/src/components/one-lottie';
import { CancelOrderCard } from '@/src/components/cancel-order-card';
import { OrderFeedback } from '@/src/components/order-feedback';
import { ReceiptShare } from '@/src/components/receipt-share';
import { RefundStatus } from '@/src/components/refund-status';
import { OrderStageCard, StageToast, useStageToast } from '@/src/components/order-stage';
import { orderStatusKey, useFormat, useTranslation } from '@/src/i18n';
import { useLiveTracking } from '@/src/use-live-tracking';
import { TrackingMap, trackingMapAvailable } from '@/src/components/tracking-map';
import { activityStepFor, describeEta, LIVE_TIMELINE, riderInitial, timelineIndex, vehicleCode, type TrackingLive, type TrackingPhase } from '@/src/utils/tracking';
import { etaCopy } from '@/src/utils/tracking-copy';

const AnimatedView = Animated.View;
// Capped to the app column so the layout holds on tablets and desktop (src/layout.tsx).
const SCREEN_W = Math.min(Dimensions.get("window").width, MAX_APP_WIDTH);
const MAP_W = SCREEN_W - spacing.lg * 2;
const MAP_H = 240;

// SVG path for rider route (cubic-bezier feel)
const ROUTE_D = `M 30 ${MAP_H - 30} Q ${MAP_W * 0.25} ${MAP_H * 0.2} ${MAP_W * 0.55} ${MAP_H * 0.45} T ${MAP_W - 30} 30`;

// Sample points along the route for the rider position (approx)
function pointOnRoute(t: number) {
  'worklet';
  // Use a set of points approximating the cubic path
  const start = { x: 30, y: MAP_H - 30 };
  const c1 = { x: MAP_W * 0.25, y: MAP_H * 0.2 };
  const mid = { x: MAP_W * 0.55, y: MAP_H * 0.45 };
  const c2 = { x: MAP_W * 0.85, y: MAP_H * 0.7 };
  const end = { x: MAP_W - 30, y: 30 };
  const pts = [start, c1, mid, c2, end];
  const seg = Math.min(Math.floor(t * (pts.length - 1)), pts.length - 2);
  const localT = t * (pts.length - 1) - seg;
  const p0 = pts[seg];
  const p1 = pts[seg + 1];
  return { x: p0.x + (p1.x - p0.x) * localT, y: p0.y + (p1.y - p0.y) * localT };
}

// Cash orders keep the old wording; online orders say what Razorpay confirmed (server/payments.ts). The server's
// payment_status is a code; this picks the catalogue sentence for it (an unknown code reads like a cash order).
const PAYMENT_NOTE_KEYS = {
  not_charged: 'tracking.paymentNote.not_charged', paid: 'tracking.paymentNote.paid', pending: 'tracking.paymentNote.pending',
  failed: 'tracking.paymentNote.failed', refunded: 'tracking.paymentNote.refunded',
} as const;
const paymentNoteKey = (code?: string | null) => PAYMENT_NOTE_KEYS[(code ?? 'not_charged') as keyof typeof PAYMENT_NOTE_KEYS] ?? PAYMENT_NOTE_KEYS.not_charged;

// The steps hold catalogue keys: status words come from the order-status mapping, the one step that is not a status has its own.
const TIMELINE: { key: string; label: ParseKeys; icon: 'checkmark-circle' | 'cube' | 'bicycle' | 'home' }[] = [
  { key: "placed", label: orderStatusKey('placed'), icon: "checkmark-circle" },
  { key: "packed", label: 'tracking.step.packedAtStore', icon: "cube" },
  { key: "out", label: orderStatusKey('out'), icon: "bicycle" },
  { key: "delivered", label: orderStatusKey('delivered'), icon: "home" },
];

// Live timeline (real GPS data): one row per phase the server reports; cancelled replaces the whole list with one row.
type StepIcon = ComponentProps<typeof Icon>['name'];
const LIVE_ICONS: Record<TrackingPhase, StepIcon> = {
  preparing: 'cube', finding_rider: 'search', to_store: 'bicycle', at_store: 'storefront',
  on_the_way: 'navigate', at_door: 'home', delivered: 'checkmark-circle', cancelled: 'close-circle',
};

export default function OrderTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const fmt = useFormat();
  const [order, setOrder] = useState<Order | null>(null);
  const [elapsedS, setElapsedS] = useState(0);
  const [failed, setFailed] = useState(false); // worded while rendering, so it follows the language
  const [retry, setRetry] = useState(0);
  const [help, setHelp] = useState(false);
  const motion = useMotionAllowed();

  // Live tracking (GET /orders/:id/tracking). `live` is set only when the server has dispatch data for this order;
  // otherwise (demo orders, no job yet, endpoint unreachable) the illustrative simulation below runs exactly as before.
  // `trackingPending` is the short wait for the first answer: a neutral skeleton, so the sample never flashes first.
  const tracking = useLiveTracking(id, { enabled: !!order && !failed });
  const live: TrackingLive | null = tracking.data?.live ? tracking.data : null;
  const trackingPending = tracking.loading && !tracking.data;
  const neutral = !!live || trackingPending;
  // The restaurant's side (0580): waiting for it, kitchen ticket, preparing, ready, or why it was cancelled. A change shows a toast.
  const orderStage = tracking.data?.stage ?? null;
  const stageToast = useStageToast(orderStage, order?.store_name ?? '');
  const awaitingRestaurant = orderStage?.stage === 'created' || orderStage?.stage === 'waiting_partner';

  // Rider animation: 0..1 over the delivery duration
  const progress = useSharedValue(0);
  const TOTAL_S = 10 * 60; // 10 min

  useEffect(() => {
    if (!id) return;
    setFailed(false);
    api<Order>(`/orders/${id}`).then(setOrder).catch(() => setFailed(true));
  }, [id, retry]);

  // The other store orders paid for in the same checkout (a shopping cart split by store).
  const [siblings, setSiblings] = useState<Order[]>([]);
  useEffect(() => {
    setSiblings([]);
    if (!order?.checkout_id) return;
    api<Checkout>(`/checkouts/${order.checkout_id}`).then(c => setSiblings(c.orders.filter(o => o.id !== order.id))).catch(() => {});
  }, [order?.id, order?.checkout_id]);

  useEffect(() => {
    // For a delightful preview we animate the rider across the route in 24s (loops after)
    progress.value = 0;
    if (motion) progress.value = withTiming(1, { duration: 24000, easing: Easing.inOut(Easing.ease) });
    return () => { cancelAnimation(progress); };
  }, [progress, motion]);

  // The sample journey is timed from when the order was placed, so reopening an order (and the
  // Live Activity, widget and notifications) all agree on where it is.
  const placedAt = order ? new Date(order.created_at).getTime() : 0;
  useEffect(() => {
    if (!placedAt) return;
    const tick = () => setElapsedS(Math.max(0, Math.floor((Date.now() - placedAt) / 1000)));
    tick(); const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [placedAt]);

  // iOS add-in layer: keep the Live Activity (lock screen / Dynamic Island) and the home-screen
  // widget in step with the order. No-ops outside an iOS development build.
  // When live, the step comes from the real phase and the ETA from the server, not from time since placing.
  const liveStep = live ? activityStepFor(live.phase, order?.status) : null; // null for cancelled
  const stage = live ? (liveStep ?? 0) : stageAt(elapsedS);
  const liveKey = live ? `${live.phase}|${live.eta?.minutes ?? ''}` : '';
  useEffect(() => {
    if (!order || trackingPending) return;
    const count = order.items.reduce((n, i) => n + i.qty, 0);
    // Worded now, in the language the app is in at this moment (the Live Activity and widget keep these words).
    const first = order.items[0]?.name ?? t('notifications.yourOrder');
    const total = fmt.money(order.total);
    const summary = order.items.length > 1 ? t('notifications.summaryMore', { name: first, n: fmt.number(order.items.length - 1), total }) : `${first} · ${total}`;
    if (live && liveStep === null) { updateOrderWidget(null); return; } // cancelled: nothing left to follow
    syncOrderActivity(order.id, stage, summary, placedAt, live?.eta ? Date.parse(live.eta.arrives_at) : undefined);
    const etaMinutes = live ? Math.max(0, Math.ceil(live.eta?.minutes ?? 0)) : Math.max(0, Math.ceil((ORDER_TOTAL_S - elapsedS) / 60));
    updateOrderWidget({ orderId: order.id, step: stage, etaMinutes, itemCount: count, total, firstItem: first });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, stage, liveKey, trackingPending]);

  const riderStyle = useAnimatedStyle(() => {
    const p = pointOnRoute(progress.value);
    return { transform: [{ translateX: p.x - 18 }, { translateY: p.y - 18 }] };
  });

  const etaLeft = Math.max(TOTAL_S - elapsedS, 0);
  const mins = Math.floor(etaLeft / 60);
  const secs = etaLeft % 60;
  const stagePct = stage;

  // ---- live-only wording and structure (all of it unused when `live` is null) ----
  // A road ETA reads "12 min"; an estimate or the checkout promise reads "About 12 min" and an "Around 7:45 pm" clock time.
  const etaWords = live ? etaCopy(describeEta(live.eta, live.phase), t, fmt) : null;
  const riderName = live?.rider?.first_name ?? t('tracking.live.riderFallback');
  const vehicle = live?.rider?.vehicle ?? null;
  const vehicleCodeName = vehicleCode(vehicle);
  const vehicleText = vehicleCodeName ? t(`tracking.vehicle.${vehicleCodeName}`) : vehicle;
  const cancelled = live?.phase === 'cancelled';
  const timelineSteps: { key: string; label: ParseKeys; icon: StepIcon }[] = !live ? TIMELINE
    : cancelled ? [{ key: 'cancelled', label: 'tracking.phase.cancelled', icon: LIVE_ICONS.cancelled }]
    // until the restaurant has confirmed (and its kitchen ticket exists) the first row says so, never "preparing"
    : LIVE_TIMELINE.map(p => ({ key: p, label: (p === 'preparing' && awaitingRestaurant ? 'tracking.phase.waiting_partner' : `tracking.phase.${p}`) as ParseKeys, icon: LIVE_ICONS[p] })); // i18n-ignore (catalogue keys)
  const currentStep = !live ? stagePct : cancelled ? 0 : timelineIndex(live.phase);
  const stepTone = cancelled ? colors.onError : colors.brandPrimary;
  const etaIcon: StepIcon = live?.phase === 'delivered' ? 'checkmark' : cancelled ? 'close' : 'bicycle-outline';

  if (!order) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        {failed ? <><Text testID="tracking-error" style={{ color: colors.onError }}>{t('tracking.loadError')}</Text><TouchableOpacity testID="tracking-retry" style={styles.homeBtn} onPress={() => setRetry(v => v + 1)}><Text style={styles.homeBtnText}>{t('common.retry')}</Text></TouchableOpacity></> : <ActivityIndicator testID="tracking-loading" color={colors.forest} />}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} testID="order-tracking">
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={styles.backBtn} testID="track-back-btn">
          <Icon name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text testID="tracking-title" style={styles.title}>{t('tracking.title')}</Text>
          {neutral
            ? <Text testID="tracking-order-ref" style={styles.sub}>{order.store_name ? t('tracking.live.subtitleStore', { id: order.id.slice(0, 8).toUpperCase(), store: order.store_name }) : t('tracking.live.subtitle', { id: order.id.slice(0, 8).toUpperCase() })}</Text>
            : <Text testID="tracking-sample-notice" style={styles.sub}>{order.store_name ? t('tracking.sampleNoticeStore', { id: order.id.slice(0, 8).toUpperCase(), store: order.store_name }) : t('tracking.sampleNotice', { id: order.id.slice(0, 8).toUpperCase() })}</Text>}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        <Text testID="order-payment-method" style={styles.riderMeta}>{`${paymentLabel(order.payment_method || 'cod')} · ${neutral && (order.payment_status ?? 'not_charged') === 'not_charged' ? t('tracking.live.payAtDoor') : t(paymentNoteKey(order.payment_status))}`}</Text>
        {((order.payment_method ?? 'cod') !== 'cod' || order.payment_status === 'refunded') && <RefundStatus orderId={order.id} />}
        <OrderStageCard stage={orderStage} store={order.store_name ?? ''} />
        {elapsedS < 12 && <View testID="order-placed-moment" style={styles.placed}>
          <OneLottie name="order-success" size={72} />
          <View style={{ flex: 1 }}><Text style={styles.placedTitle}>{t('tracking.placed')}</Text><Text style={styles.placedSub}>{t('tracking.placedSub', { amount: fmt.money(order.total) })}</Text></View>
        </View>}
        {!!order.address && <View testID="order-address" style={styles.addressCard}>
          <Icon name="location" size={20} color={colors.forest} />
          <View style={{ flex: 1 }}>
            <Text style={styles.addressTitle}>{order.address.label ? t('tracking.deliveringToLabel', { label: order.address.label }) : t('tracking.deliveringTo')}</Text>
            <Text style={styles.addressText}>{order.address.text}</Text>
            {!!order.address.notes && <Text testID="order-address-notes" style={styles.addressNotes}>{t('tracking.partnerNote', { notes: order.address.notes })}</Text>}
          </View>
        </View>}
        {siblings.length > 0 && <View testID="order-checkout-siblings" style={styles.addressCard}>
          <Icon name="storefront-outline" size={20} color={colors.forest} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={styles.addressTitle}>{t('tracking.paidTogether', { count: siblings.length })}</Text>
            {siblings.map(o => <TouchableOpacity key={o.id} testID={`order-sibling-${o.id}`} onPress={() => router.push(`/order/${o.id}` as any)} style={styles.siblingRow}>
              <Text style={styles.addressText}>{t('tracking.siblingRow', { store: o.store_name || t('orders.storeFallback'), count: o.items.length, total: fmt.money(o.total) })}</Text>
              <Icon name="chevron-forward" size={16} color={colors.muted} />
            </TouchableOpacity>)}
          </View>
        </View>}
        <VendorNote items={order.items} status={order.status} />
        {/* ETA hero */}
        {neutral ? (
          // Real ETA (or its skeleton). Every line keeps a minimum height, so a new value never moves what is below it.
          <View style={styles.etaCard} testID="eta-card">
            <View style={styles.etaLeft}>
              <Text style={styles.etaLabel}>{etaWords?.label ?? t('tracking.live.etaLabel')}</Text>
              <Text style={styles.etaTimeLive} testID="eta-time" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} accessibilityLiveRegion="polite">{etaWords?.text ?? '—'}</Text>
              <Text style={styles.etaWhen} testID="eta-arrives-by" numberOfLines={1}>{etaWords?.when || ' '}</Text>
              <Text style={styles.etaSource} testID="tracking-live-source">{etaWords?.source || ' '}</Text>
            </View>
            <View style={[styles.dispatchDot, styles.dispatchDotLive]}>
              <Icon name={etaIcon} size={32} color={colors.forestDeep} />
            </View>
          </View>
        ) : (
        <View style={styles.etaCard}>
          <View style={styles.etaLeft}>
            <Text style={styles.etaLabel}>{t('tracking.countdown')}</Text>
            <Text style={styles.etaTime} testID="eta-time">{fmt.number(mins)}:{secs < 10 ? '0' : ''}{fmt.number(secs)}</Text>
            <Text testID="tracking-animation-notice" style={styles.etaHint}>{t('tracking.routeNotice')}</Text>
          </View>
          <View style={styles.dispatchDot}>
            <Icon name="bicycle-outline" size={36} color={colors.forestDeep} />
          </View>
        </View>
        )}

        {/* Map illustration */}
        <View style={styles.mapCard} testID="tracking-map">
          {live && trackingMapAvailable ? <TrackingMap tracking={live} animate={motion} /> : trackingPending ? (
            <View style={styles.mapPending}><ActivityIndicator testID="tracking-map-loading" accessibilityLabel={t('tracking.live.loading')} color={colors.forest} /></View>
          ) : <>
          <Svg width={MAP_W} height={MAP_H}>
            {/* faux streets background */}
            <Path d={`M 0 ${MAP_H * 0.35} L ${MAP_W} ${MAP_H * 0.35}`} stroke={colors.border} strokeWidth={1} />
            <Path d={`M 0 ${MAP_H * 0.7} L ${MAP_W} ${MAP_H * 0.7}`} stroke={colors.border} strokeWidth={1} />
            <Path d={`M ${MAP_W * 0.3} 0 L ${MAP_W * 0.3} ${MAP_H}`} stroke={colors.border} strokeWidth={1} />
            <Path d={`M ${MAP_W * 0.7} 0 L ${MAP_W * 0.7} ${MAP_H}`} stroke={colors.border} strokeWidth={1} />
            {/* route */}
            <Path d={ROUTE_D} stroke={colors.brandPrimary} strokeWidth={3} strokeDasharray="6 6" fill="none" strokeLinecap="round" />
            {/* store marker */}
            <Circle cx={30} cy={MAP_H - 30} r={10} fill={colors.brandSecondary} />
            <Circle cx={30} cy={MAP_H - 30} r={4} fill={colors.brandPrimary} />
            {/* home marker */}
            <Circle cx={MAP_W - 30} cy={30} r={10} fill={colors.pastelGreen} />
            <Circle cx={MAP_W - 30} cy={30} r={4} fill={colors.onSuccess} />
          </Svg>
          <View style={styles.storeLabel}><Text style={styles.markerText}>{t('tracking.markerStore')}</Text></View>
          <View style={styles.homeLabel}><Text style={styles.markerText}>{t('tracking.markerYou')}</Text></View>
          {/* rider */}
          <AnimatedView style={[styles.rider, riderStyle]} testID="rider-marker">
            <Icon name="bicycle" size={24} color={colors.forest} />
          </AnimatedView>
          </>}
        </View>
        {live && !!tracking.error && <Text testID="tracking-reconnecting" style={styles.riderMeta}>{t('tracking.live.reconnecting')}</Text>}

        {/* Rider card */}
        {!trackingPending && <View style={styles.riderCard} testID="rider-card">
          <View style={styles.avatar}>
            {!live ? <Text style={styles.avatarText}>{order.rider_name[0]}</Text>
              : live.rider ? <Text style={styles.avatarText}>{riderInitial(live.rider.first_name)}</Text>
              : <Icon name="search" size={20} color={colors.onSurface} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.riderName} testID={live ? 'rider-name' : undefined}>{!live ? order.rider_name : live.rider ? live.rider.first_name : t('tracking.live.noRiderTitle')}</Text>
            <Text style={styles.riderMeta} testID={live ? 'rider-meta' : undefined}>{!live ? t('tracking.riderMeta') : !live.rider ? t('tracking.live.noRiderMeta') : vehicleText ? t('tracking.live.riderMeta', { vehicle: vehicleText }) : t('tracking.live.riderMetaPlain')}</Text>
          </View>
          <TouchableOpacity style={styles.callBtn} testID="call-rider-btn" accessibilityRole="button" accessibilityLabel={t('tracking.infoA11y')} onPress={() => setHelp(!help)}>
            <Icon name="information-circle-outline" size={20} color={colors.onBrandPrimary} />
          </TouchableOpacity>
        </View>}
        {help && !trackingPending && <Text testID="delivery-help" style={styles.riderMeta}>{live ? t('tracking.live.help') : t('tracking.sampleHelp')}</Text>}

        {/* Timeline */}
        {!trackingPending && <View style={styles.timeline} testID="tracking-timeline">
          <Text style={styles.timelineTitle}>{t('tracking.statusTitle')}</Text>
          {timelineSteps.map((step, i) => {
            const active = i <= currentStep;
            return (
              <View key={step.key} style={styles.timelineRow} testID={`timeline-step-${step.key}`} accessibilityState={{ selected: i === currentStep }}>
                <View style={[styles.timelineDot, active && { backgroundColor: stepTone }]}>
                  <Icon name={step.icon} size={14} color={active ? colors.onBrandPrimary : colors.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.timelineLabel, active && { color: colors.onSurface, fontWeight: "800" }]}>{t(step.label)}</Text>
                  {i === currentStep && <Text style={[styles.timelineNow, cancelled && { color: stepTone }]} testID="timeline-now">{live ? t(`tracking.phaseNow.${live.phase}`, { name: riderName }) : t('tracking.now')}</Text>}
                </View>
                {i < timelineSteps.length - 1 && <View style={[styles.timelineLine, active && { backgroundColor: stepTone }]} />}
              </View>
            );
          })}
        </View>}

        {/* Order items */}
        <View style={styles.itemsCard}>
          <Text style={styles.timelineTitle}>{t('tracking.itemsTitle', { count: order.items.length })}</Text>
          {order.items.slice(0, 4).map((i) => (
            <View key={i.id} style={styles.itemRow}>
              <Image source={i.image} style={styles.itemImg} contentFit="cover" />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName} numberOfLines={1}>{i.name}</Text>
                <Text style={styles.itemMeta}>{t('tracking.itemMeta', { weight: i.weight, qty: fmt.number(i.qty) })}</Text>
              </View>
              <Text style={styles.itemPrice}>{fmt.money(i.price * i.qty)}</Text>
            </View>
          ))}
          {order.items.length > 4 && (
            <Text style={styles.moreText}>{t('tracking.moreItems', { count: order.items.length - 4 })}</Text>
          )}
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t('tracking.grandTotal')}</Text>
            <Text style={styles.totalValue}>{fmt.money(order.total)}</Text>
          </View>
        </View>

        <OrderFeedback order={order} />
        <ReceiptShare order={order} />

        <CancelOrderCard order={order} onCancelled={() => setRetry(v => v + 1)} />

        <TouchableOpacity style={styles.homeBtn} accessibilityRole="button" onPress={() => router.push(`/help?order=${encodeURIComponent(order.id)}` as any)} testID="order-get-help">
          <Text style={styles.homeBtnText}>{t('tracking.getHelp')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.homeBtn} onPress={() => router.replace("/(tabs)" as any)} testID="continue-shopping">
          <Text style={styles.homeBtnText}>{t('tracking.continueShopping')}</Text>
        </TouchableOpacity>
      </ScrollView>
      <StageToast message={stageToast} top={insets.top + 64} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: spacing.md },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  placed: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#050605', borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  placedTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  addressCard: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  addressTitle: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  addressText: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 2, flex: 1 },
  addressNotes: { fontSize: 12, color: colors.muted, marginTop: 4 },
  siblingRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  placedSub: { color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 2 },
  etaCard: { backgroundColor: colors.brandPrimary, borderRadius: radius.lg, padding: spacing.lg, flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  etaLeft: { flex: 1 },
  etaLabel: { color: "#B8B8B8", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  etaTime: { color: colors.onBrandPrimary, fontSize: 42, fontWeight: "800", marginTop: 4 },
  etaHint: { color: colors.brandSecondary, fontSize: 12, fontWeight: "700", marginTop: 4 },
  dispatchDot: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  dispatchEmoji: { fontSize: 34 },
  // live ETA card: fixed line heights so a new value never changes the card's height
  etaTimeLive: { color: colors.onBrandPrimary, fontSize: 30, lineHeight: 40, minHeight: 40, fontWeight: "800", marginTop: 4 },
  etaWhen: { color: colors.onBrandPrimary, fontSize: 14, lineHeight: 20, minHeight: 20, fontWeight: "700" },
  etaSource: { color: colors.brandSecondary, fontSize: 12, lineHeight: 18, minHeight: 18, fontWeight: "700", marginTop: 2 },
  dispatchDotLive: { width: 56, height: 56, borderRadius: 28, marginLeft: spacing.sm },
  mapPending: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  mapCard: { width: MAP_W, height: MAP_H, backgroundColor: colors.surface, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  rider: { position: "absolute", width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  storeLabel: { position: "absolute", left: 44, bottom: 20, backgroundColor: colors.brandSecondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  homeLabel: { position: "absolute", right: 44, top: 20, backgroundColor: colors.pastelGreen, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  markerText: { fontSize: 11, fontWeight: "800", color: colors.onSurface },
  riderCard: { marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.pastelYellow, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontWeight: "800", color: colors.onSurface },
  riderName: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  riderMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  callBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  timeline: { marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
  timelineTitle: { fontSize: 14, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.md },
  timelineRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: 8, position: "relative" },
  timelineDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  timelineLine: { position: "absolute", left: 13, top: 32, bottom: -8, width: 2, backgroundColor: colors.border },
  timelineLabel: { fontSize: 13, color: colors.muted, marginTop: 4 },
  timelineNow: { fontSize: 11, color: colors.brandPrimary, marginTop: 2, fontWeight: "700" },
  itemsCard: { marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  itemImg: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
  itemName: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  itemMeta: { fontSize: 11, color: colors.muted, marginTop: 2 },
  itemPrice: { fontSize: 13, fontWeight: "800", color: colors.onSurface },
  moreText: { fontSize: 12, color: colors.muted, marginTop: 8 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
  totalRow: { flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  totalValue: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  homeBtn: { marginTop: spacing.lg, minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  homeBtnText: { color: colors.onSurface, fontWeight: "800" },
});
