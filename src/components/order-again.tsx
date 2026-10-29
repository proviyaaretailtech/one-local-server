// Home: the last order, one tap from the bag again. Shows nothing until the customer has an order that was not cancelled.
import { useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/src/ui/text';
import Icon from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { colors } from '../theme';
import { useCart } from '../cart';
import { haptic } from '../haptics';
import { reorderLines } from '../reorder';
import { useLastCheckout } from '../use-last-order';
import { useFormat, useTranslation } from '../i18n';

export function OrderAgain() {
  const orders = useLastCheckout(); const { addMany } = useCart(); const router = useRouter(); const { t } = useTranslation(); const fmt = useFormat();
  const [added, setAdded] = useState(false); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!orders) return null;
  const items = orders.flatMap(o => o.items); const total = orders.reduce((n, o) => n + o.total, 0);
  const summary = items.length > 1 ? t('home.orderAgain.more', { name: items[0].name, count: items.length - 1 }) : t('home.orderAgain.one', { name: items[0].name });
  const reorder = () => {
    haptic.add(); addMany(reorderLines(orders)); setAdded(true);
    timer.current = setTimeout(() => setAdded(false), 2500);
  };
  return <View testID="order-again" style={s.card}>
    <View style={s.icon}><Icon name="repeat" size={20} color={colors.forestDeep} /></View>
    <View style={s.copy}>
      <Text style={s.title}>{t('home.orderAgain.title')}</Text>
      <Text testID="order-again-items" numberOfLines={2} style={s.items}>{summary} · {fmt.money(total)}</Text>
    </View>
    {added
      ? <Pressable testID="order-again-view" accessibilityRole="button" onPress={() => router.navigate('/cart' as never)} style={[s.button, s.viewBag]}><Text style={[s.buttonText, s.viewBagText]}>{t('product.viewBag')}</Text></Pressable>
      : <Pressable testID="order-again-button" accessibilityRole="button" accessibilityLabel={t('home.orderAgain.title')} onPress={reorder} style={s.button}><Text style={s.buttonText}>{t('orders.reorder')}</Text></Pressable>}
  </View>;
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 18, padding: 14, borderRadius: 18, backgroundColor: colors.limeSoft },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.electricLime },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '800', color: colors.onSurface },
  items: { fontSize: 12.5, lineHeight: 17, color: colors.muted },
  button: { minHeight: 40, paddingHorizontal: 16, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.forestDeep },
  viewBag: { backgroundColor: colors.electricLime },
  viewBagText: { color: colors.forestDeep },
  buttonText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
});
