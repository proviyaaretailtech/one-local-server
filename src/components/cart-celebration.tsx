import { useEffect, useRef, useState } from 'react';
import { Animated, View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Icon from '@react-native-vector-icons/ionicons';
import { usePathname, useRouter } from 'expo-router';
import { useCart } from '../cart';
import { colors } from '../theme';
import { nativeDriver, useMotionAllowed } from '../motion';
import { CartCharacter } from './cart-character';
import { useFormat, useTranslation } from '@/src/i18n';
// The mascot greets the first add of each app session only. Every later add is confirmed by
// the floating cart bar (count + total), so the character never interrupts a shopping run.
const session = globalThis as unknown as { __onecityCelebrated?: boolean };

export function CartCelebration({ top }: { top: number }) {
  const { t } = useTranslation(); const fmt = useFormat(); const { lastAdded, totalItems } = useCart(); const router = useRouter(); const path = usePathname(); const motion = useMotionAllowed();
  const progress = useRef(new Animated.Value(0)).current; const [visible, setVisible] = useState(false);
  useEffect(() => { setVisible(false); }, [path]);
  useEffect(() => {
    if (!lastAdded || session.__onecityCelebrated) return;
    session.__onecityCelebrated = true; setVisible(true); progress.setValue(motion ? 0 : 1);
    if (motion) Animated.spring(progress, { toValue: 1, friction: 6, tension: 65, useNativeDriver: nativeDriver }).start();
  }, [lastAdded, motion, progress]);
  // Hiding is keyed on visibility alone, so a quick second add can't cancel it and strand the mascot.
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), motion ? 3400 : 4500);
    return () => clearTimeout(timer);
  }, [visible, motion]);
  if (!visible || !lastAdded) return null;
  return <Animated.View testID="cart-added-popup" accessibilityLiveRegion="polite" style={[s.overlay, { top: top + 64, opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [70, 0] }) }, { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
    <View style={s.characterWrap}><View style={s.aura} /><CartCharacter revision={lastAdded.revision} /><Image testID="cart-added-image" source={lastAdded.product.image} contentFit="contain" style={s.product} /><Icon name="sparkles" color={colors.gold} size={22} style={s.sparkle} /></View>
    <View style={s.bubble}><Pressable testID="cart-added-dismiss" accessibilityLabel={t('cart.added.dismissA11y')} onPress={() => setVisible(false)} style={s.close}><Icon name="close" size={17} color={colors.muted} /></Pressable><Text testID="cart-added-title" style={s.title}>{t('cart.added.title')}</Text><Text testID="cart-added-product" numberOfLines={3} style={s.name}>{t('cart.added.body', { name: lastAdded.product.name })}</Text><Pressable testID="cart-added-open" accessibilityLabel={t('cart.added.viewA11y', { count: totalItems })} style={s.action} onPress={() => { setVisible(false); router.navigate('/cart'); }}><Text style={s.actionText}>{t('cart.added.view', { n: fmt.number(totalItems) })}</Text><Icon name="arrow-forward" size={15} color={colors.shops} /></Pressable></View>
  </Animated.View>;
}
const s = StyleSheet.create({ overlay: { position: 'absolute', right: 8, zIndex: 100, width: 192, alignItems: 'center', pointerEvents: 'box-none' }, characterWrap: { width: 186, height: 188, pointerEvents: 'none' }, aura: { position: 'absolute', top: 36, left: 10, width: 140, height: 140, borderRadius: 80, backgroundColor: colors.glass }, product: { position: 'absolute', right: 19, bottom: 28, width: 39, height: 43, borderRadius: 8 }, sparkle: { position: 'absolute', left: 2, top: 25 }, bubble: { width: 178, marginTop: -7, borderRadius: 24, borderTopRightRadius: 8, backgroundColor: colors.surface, paddingHorizontal: 14, paddingTop: 17, boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 24, color: colors.shadow }], borderWidth: 1, borderColor: colors.shopsMid }, close: { position: 'absolute', top: -9, right: -9, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { color: colors.shops, fontSize: 18, fontWeight: '800' }, name: { color: colors.onSurface, fontSize: 11, lineHeight: 16, marginTop: 5, paddingRight: 3 }, action: { minHeight: 44, flexDirection: 'row', gap: 6, alignItems: 'center' }, actionText: { color: colors.shops, fontSize: 11, fontWeight: '700' } });