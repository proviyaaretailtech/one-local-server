import { useEffect, useRef } from 'react';
import { useAppDimensions } from '../layout';
import { View, Animated, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import Icon from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { useCart } from '../cart';
import { ThemeColors } from '../theme';
import { usePageColors } from '../use-page-colors';
import { nativeDriver, useMotionAllowed } from '../motion';
import { useFormat, useTranslation } from '../i18n';

export function FloatingCart({ bottom, compact = false }: { bottom: number; compact?: boolean }) {
  const colors = usePageColors(); const styles = getStyles(colors); const { t } = useTranslation(); const fmt = useFormat();
  const { items, totalItems, totalPrice, totalMrp, lastAdded } = useCart();
  const router = useRouter(); const motion = useMotionAllowed(); const { height, width } = useAppDimensions();
  const entrance = useRef(new Animated.Value(0)).current; const bump = useRef(new Animated.Value(1)).current; const flight = useRef(new Animated.Value(1)).current;
  useEffect(() => { if (!motion) { entrance.setValue(totalItems ? 1 : 0); return; } const animation = Animated.spring(entrance, { toValue: totalItems ? 1 : 0, friction: 8, useNativeDriver: nativeDriver }); animation.start(); return () => animation.stop(); }, [entrance, totalItems, motion]);
  useEffect(() => {
    if (!lastAdded || !motion) return;
    flight.setValue(0); bump.setValue(1);
    const animation = Animated.parallel([Animated.timing(flight, { toValue: 1, duration: 650, useNativeDriver: nativeDriver }), Animated.sequence([Animated.delay(400), Animated.spring(bump, { toValue: 1.035, friction: 4, useNativeDriver: nativeDriver }), Animated.spring(bump, { toValue: 1, friction: 5, useNativeDriver: nativeDriver })])]);
    animation.start(); return () => animation.stop();
  }, [lastAdded, motion, flight, bump]);
  if (!totalItems) return null;
  const start = lastAdded?.origin || { x: width * 0.65, y: height - bottom - 170 };
  const endY = height - bottom - 45;
  if (compact) return <Animated.View testID="floating-cart" style={[styles.position, styles.compactPosition, { bottom, left: Math.max(24, (width-278)/2), right: Math.max(24, (width-278)/2), opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [90, 0] }) }, { scale: bump }] }]}><Pressable testID="floating-cart-open" accessibilityLabel={t('shell.cartBar.open', { count: totalItems, total: fmt.money(totalPrice) })} onPress={() => router.navigate('/cart')} style={({ pressed }) => [styles.compactBar, pressed && styles.pressed]}><View style={styles.thumbnails}>{items.slice(-2).map((item,i) => <Image key={item.id} testID={`subcategory-cart-image-${item.id}`} source={item.image} contentFit="contain" style={[styles.compactThumb, { marginLeft: i ? -16 : 0 }]} />)}</View><View style={styles.flex}><Text testID="subcategory-cart-title" style={styles.compactTitle}>{t('shell.cartBar.view')}</Text><Text testID="floating-cart-count" style={styles.compactCount}>{t('shell.cartBar.items', { count: totalItems })}<Text testID="floating-cart-price">{` · ${fmt.money(totalPrice)}`}</Text></Text></View><View style={styles.compactArrow}><Icon name="chevron-forward" size={25} color={colors.forest} /></View></Pressable></Animated.View>;
  return <>
    {motion && lastAdded && <Animated.View testID="cart-flying-product" style={[styles.flying, { opacity: flight.interpolate({ inputRange: [0, 0.05, 0.85, 1], outputRange: [0, 1, 1, 0] }), transform: [{ translateX: flight.interpolate({ inputRange: [0, 1], outputRange: [start.x - 22, 26] }) }, { translateY: flight.interpolate({ inputRange: [0, 0.35, 1], outputRange: [start.y - 22, Math.min(start.y - 95, endY - 100), endY] }) }, { scale: flight.interpolate({ inputRange: [0, 1], outputRange: [1.15, 0.5] }) }] }]}><Image source={lastAdded.product.image} style={styles.flyingImage} /></Animated.View>}
    {/* One slim pill (after Glovo): what is in the bag and the total on the left, the free-delivery line as a
        quiet second row with its progress drawn along the pill's bottom edge, one action on the right. */}
    <Animated.View testID="floating-cart" style={[styles.position, { bottom, opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [110, 0] }) }, { scale: bump }] }]}>
      <Pressable testID="floating-cart-open" accessibilityLabel={t('shell.cartBar.open', { count: totalItems, total: fmt.money(totalPrice) })} onPress={() => router.navigate('/cart' as any)} style={styles.bar}>
        <View style={styles.thumbnails}>{items.slice(-2).map((item, i) => <Image key={item.id} source={item.image} style={[styles.thumb, { marginLeft: i ? -14 : 0 }]} />)}</View>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={styles.count}><Text testID="floating-cart-count">{t('shell.cartBar.items', { count: totalItems })}</Text><Text style={styles.dotSep}>  ·  </Text><Text testID="floating-cart-price" style={styles.price}>{fmt.money(totalPrice)}</Text></Text>
          <Text testID="floating-cart-savings" numberOfLines={1} style={styles.savingsText}>{totalPrice >= 199 ? t('shell.cartBar.freeDelivery', { amount: fmt.money(Math.max(0, totalMrp - totalPrice)) }) : t('shell.cartBar.awayFromFree', { amount: fmt.money(199 - totalPrice) })}</Text>
        </View>
        <View style={styles.cta}><Text style={styles.ctaText}>{t('shell.cartBar.view')}</Text><Icon name="arrow-forward" size={15} color={colors.forestDeep} /></View>
        <View pointerEvents="none" style={styles.progressTrack}><View style={[styles.progress, { width: `${Math.min(100, totalPrice / 199 * 100)}%` }]} /></View>
      </Pressable>
    </Animated.View>
  </>;
}
const getStyles = (colors: ThemeColors) => StyleSheet.create({
  compactPosition: { borderRadius: 40, backgroundColor: colors.forest }, compactBar: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 9, paddingLeft: 12 }, compactThumb: { width: 43, height: 43, borderRadius: 22, borderWidth: 2, borderColor: colors.surface, backgroundColor: colors.surface }, compactTitle: { color: colors.surface, fontSize: 16, fontWeight: '600' }, compactCount: { color: colors.cityMid, fontSize: 10, marginTop: 4 }, compactArrow: { width: 45, height: 45, borderRadius: 23, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  position: { position: 'absolute', left: 16, right: 16, zIndex: 40, borderRadius: 22, backgroundColor: colors.forestDeep, boxShadow: [{ offsetX: 0, offsetY: 10, blurRadius: 24, color: 'rgba(16,59,43,0.28)' }] },
  bar: { borderRadius: 22, paddingVertical: 9, paddingLeft: 10, paddingRight: 9, minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, overflow: 'hidden' },
  thumbnails: { flexDirection: 'row' }, thumb: { width: 38, height: 38, borderRadius: 12, borderWidth: 2, borderColor: colors.forestDeep, backgroundColor: colors.surface }, flex: { flex: 1 },
  count: { color: colors.surface, fontSize: 14, fontWeight: '700' }, dotSep: { color: 'rgba(255,255,255,0.4)' }, price: { color: colors.lime },
  savingsText: { fontSize: 11, color: 'rgba(255,255,255,0.66)', fontWeight: '500', marginTop: 2 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.lime },
  ctaText: { fontSize: 13, fontWeight: '800', color: colors.forestDeep },
  progressTrack: { position: 'absolute', left: 18, right: 18, bottom: 0, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' }, progress: { height: 2, backgroundColor: colors.lime },
  flying: { position: 'absolute', left: 0, top: 0, zIndex: 60, width: 44, height: 44, pointerEvents: 'none' }, flyingImage: { width: 44, height: 44, borderRadius: 16, borderWidth: 2, borderColor: colors.lime }, pressed: { opacity: 0.8 },
});