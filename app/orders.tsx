// My Orders. Orders placed together (one per store, paid once) show as one checkout card with a
// row per store; older orders and single-store checkouts look as they always did.
import { useState, useCallback, useMemo } from "react";
import { View, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from "react-native";
import { Text } from "@/src/ui/text";
import { Image } from "expo-image";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { colors, radius, spacing } from "@/src/theme";
import { api, Order } from "@/src/api";
import { useCart } from "@/src/cart";
import { reorderLines } from "@/src/reorder";
import { useAuth } from "@/src/auth";
import { supabase } from "@/src/lib/supabase";
import { orderStatusKey, useFormat, useTranslation } from "@/src/i18n";

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { addMany } = useCart();
  const { t } = useTranslation();
  const fmt = useFormat();
  // GET /orders answers for this phone's key AND, when signed in, the account (server/store.ts listOrders via
  // caller().matches). So a guest still sees the orders placed on this phone; signing in adds the account's orders
  // from any phone. Signed out (and this build has sign-in at all, as in the cart): offer sign-in, keep the list.
  const auth = useAuth();
  const signedOut = !!supabase && auth.ready && !auth.session;
  const [orders, setOrders] = useState<Order[]>([]);
  // Newest checkout first; its store orders in the order they were in the cart.
  const checkouts = useMemo(() => {
    const groups: { key: string; orders: Order[] }[] = [];
    for (const o of orders) {
      const key = o.checkout_id ?? o.id;
      const group = groups.find(g => g.key === key);
      if (group) group.orders.push(o); else groups.push({ key, orders: [o] });
    }
    for (const g of groups) g.orders.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return groups;
  }, [orders]);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false); // the message is worded while rendering, so it follows the language
  const [reordered, setReordered] = useState<string | null>(null);

  const fetchOrders = useCallback(() => {
    setRefreshing(true);
    setFailed(false);
    api<Order[]>("/orders")
      .then(setOrders)
      .catch(() => setFailed(true))
      .finally(() => setRefreshing(false));
  }, []);

  // Also refetches when the account changes (back from sign-in, or signed out), so the list matches who is asking.
  useFocusEffect(useCallback(() => { fetchOrders(); }, [fetchOrders, auth.session?.user?.id])); // eslint-disable-line react-hooks/exhaustive-deps

  // Everything from the checkout, into the right cart (food from another restaurant asks first).
  const reorder = (key: string, list: Order[]) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addMany(reorderLines(list));
    setReordered(key);
    setTimeout(() => setReordered(null), 1500);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} testID="orders-screen">
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={styles.backBtn} testID="orders-back-btn">
          <Icon name="chevron-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('orders.title')}</Text>
          <Text style={styles.sub}>{t('orders.count', { count: checkouts.length })}</Text>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchOrders} />}
      >
        {signedOut && <View style={styles.signInCard} testID="orders-signed-out">
          <Icon name="person-circle-outline" size={28} color={colors.onSurface} />
          <View style={{ flex: 1 }}>
            <Text style={styles.signInTitle}>{t('orders.signedOutTitle')}</Text>
            <Text style={styles.emptySub}>{t('orders.signedOutSub')}</Text>
          </View>
          <TouchableOpacity testID="orders-sign-in" accessibilityRole="button" style={styles.signInBtn} onPress={() => router.push('/sign-in?next=/orders' as never)}>
            <Text style={styles.shopBtnText}>{t('orders.signIn')}</Text>
          </TouchableOpacity>
        </View>}
        {failed && <View style={styles.empty} testID="orders-error"><Text style={styles.emptySub}>{t('orders.loadError')}</Text><TouchableOpacity testID="orders-retry" style={styles.shopBtn} onPress={fetchOrders}><Text style={styles.shopBtnText}>{t('common.retry')}</Text></TouchableOpacity></View>}
        {orders.length === 0 && !failed ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📦</Text>
            <Text style={styles.emptyTitle}>{t('orders.emptyTitle')}</Text>
            <Text style={styles.emptySub}>{t('orders.emptySub')}</Text>
            <TouchableOpacity style={styles.shopBtn} onPress={() => router.replace("/(tabs)" as any)}>
              <Text style={styles.shopBtnText}>{t('orders.startShopping')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          checkouts.map(({ key, orders: list }) => {
            const first = list[0]; const many = list.length > 1;
            const track = (o: Order) => <TouchableOpacity style={styles.trackBtn} onPress={() => router.push(`/order/${o.id}` as any)} testID={`track-${o.id}`}>
              <Icon name="location-outline" size={14} color={colors.onSurface} />
              <Text style={styles.trackText}>{t('orders.track')}</Text>
            </TouchableOpacity>;
            return <View key={key} style={styles.card} testID={many ? `checkout-${key}` : `order-${first.id}`}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderId} numberOfLines={1}>{many ? t('orders.cardStores', { id: key.slice(0, 8).toUpperCase(), n: fmt.number(list.length) }) : `#${key.slice(0, 8).toUpperCase()}${first.store_name ? ` · ${first.store_name}` : ''}`}</Text>
                  <Text style={styles.orderDate}>{fmt.dateTime(first.created_at)}</Text>
                </View>
                <View style={[styles.statusPill, { backgroundColor: colors.pastelGreen }]}>
                  <Text style={styles.statusText}>{t(orderStatusKey(first.status))}</Text>
                </View>
              </View>

              {list.map(o => <View key={o.id} style={many ? styles.storePart : undefined} testID={many ? `order-${o.id}` : undefined}>
                {many && <View style={styles.storeHead}>
                  <View style={{ flex: 1 }}><Text style={styles.storeName} numberOfLines={1}>{o.store_name || t('orders.storeFallback')}</Text><Text style={styles.footerMeta}>{t('orders.storeMeta', { total: fmt.money(o.total), count: o.items.length })}</Text></View>
                  {track(o)}
                </View>}
                <View style={styles.imgRow}>
                  {o.items.slice(0, 4).map((i) => (
                    <Image key={i.id} source={i.image} style={styles.itemImg} contentFit="cover" />
                  ))}
                  {o.items.length > 4 && (
                    <View style={styles.moreBadge}>
                      <Text style={styles.moreText}>+{o.items.length - 4}</Text>
                    </View>
                  )}
                </View>
              </View>)}

              <View style={styles.footer}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.total}>{fmt.money(list.reduce((s, o) => s + o.total, 0))}</Text>
                  <Text style={styles.footerMeta}>{t(many ? 'orders.itemsTogether' : 'orders.items', { count: list.reduce((n, o) => n + o.items.length, 0) })}</Text>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 1, gap: spacing.sm }}>
                  {!many && track(first)}
                  <TouchableOpacity style={styles.reorderBtn} onPress={() => reorder(key, list)} testID={`reorder-${first.id}`}>
                    <Icon name={reordered === key ? "checkmark" : "repeat"} size={14} color={colors.onBrandPrimary} />
                    <Text style={styles.reorderText}>{reordered === key ? t('orders.reordered') : t('orders.reorder')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>;
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  empty: { alignItems: "center", padding: spacing.xl },
  emptyEmoji: { fontSize: 56, marginBottom: spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.onSurface },
  emptySub: { fontSize: 13, color: colors.muted, marginTop: 4 },
  shopBtn: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: radius.pill },
  shopBtnText: { color: colors.onBrandPrimary, fontWeight: "800" },
  signInCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  signInTitle: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  signInBtn: { minHeight: 44, justifyContent: "center", backgroundColor: colors.brandPrimary, paddingHorizontal: 16, borderRadius: radius.pill },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderId: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  orderDate: { fontSize: 11, color: colors.muted, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginLeft: spacing.sm, maxWidth: "55%" },
  statusText: { fontSize: 11, fontWeight: "800", color: colors.onSuccess },
  imgRow: { flexDirection: "row", gap: 6, marginTop: spacing.md },
  storePart: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  storeHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  storeName: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  itemImg: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
  moreBadge: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  moreText: { fontSize: 12, fontWeight: "800", color: colors.onSurface },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.md },
  total: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  footerMeta: { fontSize: 11, color: colors.muted, marginTop: 2 },
  trackBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  trackText: { fontSize: 12, fontWeight: "800", color: colors.onSurface },
  reorderBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  reorderText: { fontSize: 12, fontWeight: "800", color: colors.onBrandPrimary },
});
