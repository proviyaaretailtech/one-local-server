// My Orders. Orders placed together (one per store, paid once) show as one checkout card with a
// row per store; older orders and single-store checkouts look as they always did.
import { useState, useCallback, useMemo } from "react";
import { View, StyleSheet, Pressable, RefreshControl } from "react-native";
import { Text } from "@/src/ui/text";
import { Image } from "expo-image";
import { useRouter, useFocusEffect } from "expo-router";
import Icon from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { colors, popBase, radius, spacing } from "@/src/theme";
import { api, Order } from "@/src/api";
import { useCart } from "@/src/cart";
import { reorderLines } from "@/src/reorder";
import { useAuth } from "@/src/auth";
import { supabase } from "@/src/lib/supabase";
import { orderStatusKey, useFormat, useTranslation } from "@/src/i18n";
import { AccountLayout, accountStyles as a } from "@/src/components/account-layout";
import { Button } from "@/src/ui/button";
import { EmptyState } from "@/src/ui/states";

export default function OrdersScreen() {
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
    <AccountLayout id="orders" title={t('orders.title')} subtitle={t('orders.count', { count: checkouts.length })} fallback="/(tabs)" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchOrders} tintColor={colors.forest} />}>
      {signedOut && <View style={[a.card, a.row]} testID="orders-signed-out">
        <View style={a.tile}><Icon name="person-circle-outline" size={22} color={colors.forest} /></View>
        <View style={a.flex}>
          <Text style={styles.strong}>{t('orders.signedOutTitle')}</Text>
          <Text style={styles.meta}>{t('orders.signedOutSub')}</Text>
        </View>
        <Pressable testID="orders-sign-in" accessibilityRole="button" style={styles.go} onPress={() => router.push('/sign-in?next=/orders')}>
          <Text style={styles.goText}>{t('orders.signIn')}</Text>
        </Pressable>
      </View>}
      {failed && <View style={a.card} testID="orders-error"><Text style={a.hint}>{t('orders.loadError')}</Text><Button testID="orders-retry" variant="quiet" icon="refresh" title={t('common.retry')} onPress={fetchOrders} /></View>}
      {orders.length === 0 && !failed ? (
        <EmptyState testID="orders-empty" icon="bag-handle-outline" title={t('orders.emptyTitle')} body={t('orders.emptySub')}>
          <Button testID="orders-start-shopping" title={t('orders.startShopping')} onPress={() => router.replace("/(tabs)")} />
        </EmptyState>
      ) : (
        checkouts.map(({ key, orders: list }) => {
          const first = list[0]; const many = list.length > 1;
          const track = (o: Order) => <Pressable style={styles.track} onPress={() => router.push(`/order/${o.id}`)} testID={`track-${o.id}`}>
            <Icon name="location-outline" size={14} color={colors.forest} />
            <Text style={styles.trackText}>{t('orders.track')}</Text>
          </Pressable>;
          return <View key={key} style={[a.card, styles.card]} testID={many ? `checkout-${key}` : `order-${first.id}`}>
            <View style={styles.head}>
              <View style={a.flex}>
                <Text style={styles.strong} numberOfLines={1}>{many ? t('orders.cardStores', { id: key.slice(0, 8).toUpperCase(), n: fmt.number(list.length) }) : `#${key.slice(0, 8).toUpperCase()}${first.store_name ? ` · ${first.store_name}` : ''}`}</Text>
                <Text style={styles.meta}>{fmt.dateTime(first.created_at)}</Text>
              </View>
              <View style={styles.status}>
                <Text style={styles.statusText}>{t(orderStatusKey(first.status))}</Text>
              </View>
            </View>

            {list.map(o => <View key={o.id} style={many ? styles.storePart : undefined} testID={many ? `order-${o.id}` : undefined}>
              {many && <View style={styles.storeHead}>
                <View style={a.flex}><Text style={styles.strong} numberOfLines={1}>{o.store_name || t('orders.storeFallback')}</Text><Text style={styles.meta}>{t('orders.storeMeta', { total: fmt.money(o.total), count: o.items.length })}</Text></View>
                {track(o)}
              </View>}
              <View style={styles.photos}>
                {o.items.slice(0, 4).map((i) => (
                  <Image key={i.id} source={i.image} style={styles.photo} contentFit="cover" />
                ))}
                {o.items.length > 4 && (
                  <View style={styles.photo}>
                    <Text style={styles.more}>+{fmt.number(o.items.length - 4)}</Text>
                  </View>
                )}
              </View>
            </View>)}

            <View style={styles.footer}>
              <View style={styles.sum}>
                <Text style={styles.total}>{fmt.money(list.reduce((s, o) => s + o.total, 0))}</Text>
                <Text style={styles.meta}>{t(many ? 'orders.itemsTogether' : 'orders.items', { count: list.reduce((n, o) => n + o.items.length, 0) })}</Text>
              </View>
              <View style={styles.actions}>
                {!many && track(first)}
                <Pressable style={styles.go} onPress={() => reorder(key, list)} testID={`reorder-${first.id}`}>
                  <Icon name={reordered === key ? "checkmark" : "repeat"} size={14} color={colors.surface} />
                  <Text style={styles.goText}>{reordered === key ? t('orders.reordered') : t('orders.reorder')}</Text>
                </Pressable>
              </View>
            </View>
          </View>;
        })
      )}
    </AccountLayout>
  );
}

const PHOTO = 48;
const styles = StyleSheet.create({
  card: { gap: spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  strong: { fontSize: 15, lineHeight: 21, fontWeight: "800", color: colors.onSurface },
  meta: { fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: 2 },
  status: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.limeSoft, maxWidth: "55%" },
  statusText: { fontSize: 11, fontWeight: "800", color: colors.forest },
  storePart: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  storeHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  photos: { flexDirection: "row", gap: 8, marginTop: spacing.sm },
  photo: { width: PHOTO, height: PHOTO, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  more: { fontSize: 12, fontWeight: "800", color: colors.onSurface },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  sum: { flexShrink: 1 },
  total: { fontSize: 18, lineHeight: 24, fontWeight: "800", letterSpacing: -0.3, color: colors.onSurface },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 1, gap: spacing.sm },
  track: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  trackText: { fontSize: 13, fontWeight: "800", color: colors.forest },
  // The way forward (reorder, sign in): the brand green, raised on a darker base like a picked chip.
  go: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.forest, boxShadow: popBase(3, colors.forestDeep) },
  goText: { fontSize: 13, fontWeight: "800", color: colors.surface },
});
